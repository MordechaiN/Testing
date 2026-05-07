import os
import time
from datetime import datetime

from celery import Celery
from celery.schedules import crontab

import httpx

from audio_processor import (
    cleanup_stored_audio_older_than,
    cleanup_temp_files,
    process_audio,
)
from database import (
    get_audio_paths_for_cleanup,
    get_session,
    mark_audio_deleted,
    save_transcription_error,
    save_transcription_result,
    upsert_user,
)
from language_cache import get_transcription_params, set_cached_language
from logging_config import get_logger
from rate_limiter import add_used_seconds, release_queue_slot
from transcriber import transcribe_chunks

REDIS_URL = os.environ["REDIS_URL"]
AUDIO_RETENTION_DAYS = int(os.environ.get("AUDIO_RETENTION_DAYS", "30"))

log = get_logger(__name__)

app = Celery("transcription", broker=REDIS_URL, backend=REDIS_URL)

app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_soft_time_limit=300,
    task_time_limit=360,
    task_reject_on_worker_lost=True,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "cleanup-old-audio": {
            "task": "tasks.cleanup_old_audio_task",
            "schedule": crontab(hour=3, minute=0),
        },
        "cleanup-temp-files": {
            "task": "tasks.cleanup_temp_task",
            "schedule": crontab(hour=3, minute=30),
        },
    },
)


@app.task(bind=True, max_retries=2, queue="transcription", name="tasks.transcribe_audio")
def transcribe_audio(
    self,
    job_id: str,
    audio_path: str,
    callback_url: str | None,
    sender_id: str,
    sender_hash: str,
    requested_language: str,
    queued_at_ts: float,
):
    job_log = log.bind(job_id=job_id, sender_hash=sender_hash[:8])
    processing_started = datetime.utcnow()
    queue_wait_s = time.time() - queued_at_ts
    stored_path = None
    wav_path = None
    chunk_paths = []

    job_log.info("job.start", queue_wait_s=round(queue_wait_s, 2), retry=self.request.retries)

    try:
        stored_path, wav_path, chunk_paths, duration_s, audio_size = process_audio(
            audio_path, job_id
        )

        tparams = get_transcription_params(sender_hash, requested_language)
        model_name = os.environ.get("WHISPER_MODEL", "medium")

        job_log.info(
            "transcription.start",
            duration_s=round(duration_s, 1),
            model=model_name,
            language_hint=tparams.get("language"),
            chunks=len(chunk_paths),
        )

        result = transcribe_chunks(
            chunk_paths,
            language=tparams.get("language"),
            initial_prompt=tparams.get("initial_prompt"),
            beam_size=tparams.get("beam_size", 5),
        )

        processing_time_s = (datetime.utcnow() - processing_started).total_seconds()

        set_cached_language(sender_hash, result.language_detected, result.language_confidence)
        add_used_seconds(sender_hash, duration_s)

        with get_session() as session:
            user_id = upsert_user(session, sender_id, sender_hash)
            save_transcription_result(
                session,
                job_id=job_id,
                user_id=user_id,
                text=result.text,
                lang_requested=requested_language,
                lang_detected=result.language_detected,
                lang_confidence=result.language_confidence,
                audio_duration_s=duration_s,
                audio_size_bytes=audio_size,
                audio_path=stored_path,
                processing_time_s=processing_time_s,
                queue_wait_time_s=queue_wait_s,
                chunk_count=result.chunk_count,
                model_used=model_name,
                processing_started_at=processing_started,
                retry_count=self.request.retries,
            )

        job_log.info(
            "job.done",
            duration_s=round(duration_s, 1),
            processing_time_s=round(processing_time_s, 2),
            language_detected=result.language_detected,
            language_confidence=round(result.language_confidence, 3),
            chunk_count=result.chunk_count,
            text_length=len(result.text),
        )

        if callback_url:
            _send_callback(callback_url, job_id, sender_id, result.text, result.language_detected)

    except Exception as exc:
        error_str = str(exc)
        job_log.error(
            "job.failed",
            error=error_str[:300],
            retry=self.request.retries,
        )
        try:
            with get_session() as session:
                save_transcription_error(session, job_id, error_str, self.request.retries)
        except Exception:
            pass

        raise self.retry(exc=exc, countdown=min(30 * (self.request.retries + 1), 120))

    finally:
        release_queue_slot(sender_hash)
        cleanup_temp_files(audio_path, wav_path, *chunk_paths)


def _send_callback(callback_url: str, job_id: str, sender_id: str, text: str, language: str):
    try:
        httpx.post(
            callback_url,
            json={
                "job_id": job_id,
                "sender_id": sender_id,
                "text": text,
                "language": language,
            },
            timeout=15,
        )
    except Exception as e:
        log.warning("callback.failed", job_id=job_id, error=str(e)[:100])


@app.task(name="tasks.cleanup_old_audio_task")
def cleanup_old_audio_task():
    """
    Delete audio files older than AUDIO_RETENTION_DAYS from audio store.
    Also marks corresponding DB rows as audio_deleted=True.
    """
    deleted_count = cleanup_stored_audio_older_than(AUDIO_RETENTION_DAYS)

    with get_session() as session:
        rows = get_audio_paths_for_cleanup(session, AUDIO_RETENTION_DAYS)
        job_ids = [r[0] for r in rows]
        if job_ids:
            mark_audio_deleted(session, job_ids)

    log.info(
        "retention.cleanup",
        retention_days=AUDIO_RETENTION_DAYS,
        files_deleted=deleted_count,
        db_rows_marked=len(job_ids) if "job_ids" in dir() else 0,
    )


@app.task(name="tasks.cleanup_temp_task")
def cleanup_temp_task():
    """Remove audio temp files older than 2 hours (safety net)."""
    import glob
    temp_dir = os.environ.get("AUDIO_TEMP_DIR", "/app/audio_temp")
    now = time.time()
    deleted = 0
    for f in glob.glob(os.path.join(temp_dir, "*")):
        if os.path.isfile(f) and (now - os.path.getmtime(f)) > 7200:
            try:
                os.unlink(f)
                deleted += 1
            except OSError:
                pass
    log.info("cleanup.temp", files_deleted=deleted)
