import os
import time
from datetime import datetime

from celery import Celery
from celery.schedules import crontab

import httpx

from audio_processor import cleanup_files, process_audio
from database import (
    aggregate_daily_stats,
    get_session,
    save_transcription_error,
    save_transcription_result,
    upsert_user,
)
from language_cache import get_transcription_params, set_cached_language
from transcriber import transcribe_chunks

REDIS_URL = os.environ["REDIS_URL"]

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
        "aggregate-daily-stats": {
            "task": "tasks.aggregate_stats_task",
            "schedule": crontab(hour=0, minute=5),
        },
        "cleanup-old-temp-files": {
            "task": "tasks.cleanup_temp_task",
            "schedule": crontab(hour=3, minute=0),
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
    wav_path = None
    chunk_paths = []
    processing_started = datetime.utcnow()
    queue_wait_s = time.time() - queued_at_ts

    try:
        wav_path, chunk_paths, duration_s, audio_size = process_audio(audio_path)

        tparams = get_transcription_params(sender_hash, requested_language)
        model_name = os.environ.get("WHISPER_MODEL", "medium")

        result = transcribe_chunks(
            chunk_paths,
            language=tparams.get("language"),
            initial_prompt=tparams.get("initial_prompt"),
            beam_size=tparams.get("beam_size", 5),
        )

        processing_time_s = (datetime.utcnow() - processing_started).total_seconds()

        set_cached_language(sender_hash, result.language_detected, result.language_confidence)

        with get_session() as session:
            user_id = upsert_user(session, sender_id)
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
                processing_time_s=processing_time_s,
                queue_wait_time_s=queue_wait_s,
                chunk_count=result.chunk_count,
                model_used=model_name,
                processing_started_at=processing_started,
            )

        if callback_url:
            _send_callback(callback_url, job_id, sender_id, result.text, result.language_detected)

    except Exception as exc:
        error_msg = str(exc)
        try:
            with get_session() as session:
                save_transcription_error(session, job_id, error_msg)
        except Exception:
            pass

        raise self.retry(exc=exc, countdown=min(30 * (self.request.retries + 1), 120))

    finally:
        cleanup_files(audio_path, wav_path, *chunk_paths)


def _send_callback(callback_url: str, job_id: str, sender_id: str, text: str, language: str):
    try:
        httpx.post(
            callback_url,
            json={"job_id": job_id, "sender_id": sender_id, "text": text, "language": language},
            timeout=15,
        )
    except Exception:
        pass


@app.task(name="tasks.aggregate_stats_task")
def aggregate_stats_task():
    with get_session() as session:
        aggregate_daily_stats(session)


@app.task(name="tasks.cleanup_temp_task")
def cleanup_temp_task():
    """Remove audio temp files older than 1 hour."""
    import glob
    import time

    temp_dir = os.environ.get("AUDIO_TEMP_DIR", "/app/audio_temp")
    now = time.time()
    for f in glob.glob(os.path.join(temp_dir, "*")):
        if os.path.isfile(f) and (now - os.path.getmtime(f)) > 3600:
            try:
                os.unlink(f)
            except OSError:
                pass
