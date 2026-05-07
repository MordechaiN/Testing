import os
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime

import redis as _redis
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import func, text

from database import (
    Transcription, User,
    get_session, init_db,
    message_already_processed,
)
from language_cache import hash_sender_id
from logging_config import get_logger
from rate_limiter import (
    MAX_SINGLE_AUDIO_MINUTES,
    check_and_consume,
    get_user_quota_status,
)
from tasks import transcribe_audio

log = get_logger(__name__)

AUDIO_TEMP_DIR = os.environ.get("AUDIO_TEMP_DIR", "/app/audio_temp")
AUDIO_STORE_DIR = os.environ.get("AUDIO_STORE_DIR", "/app/audio_store")
REDIS_URL = os.environ["REDIS_URL"]


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(AUDIO_TEMP_DIR, exist_ok=True)
    os.makedirs(AUDIO_STORE_DIR, exist_ok=True)
    init_db()
    log.info("app.start", model=os.environ.get("WHISPER_MODEL", "medium"))
    yield


app = FastAPI(title="Transcription Service", lifespan=lifespan)


# ── Core endpoints ─────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": os.environ.get("WHISPER_MODEL", "medium"),
        "retention_days": int(os.environ.get("AUDIO_RETENTION_DAYS", "30")),
    }


@app.post("/transcribe")
async def submit_transcription(
    audio: UploadFile = File(...),
    sender_id: str = Form(...),
    message_id: str = Form(None),
    callback_url: str = Form(None),
    language: str = Form("auto"),
):
    if not sender_id:
        raise HTTPException(400, "sender_id is required")

    sender_hash = hash_sender_id(sender_id)
    request_log = log.bind(sender_hash=sender_hash[:8], message_id=message_id)

    # 1. Deduplication: reject if this WhatsApp message was already queued
    if message_id:
        with get_session() as session:
            existing_job = message_already_processed(session, message_id)
        if existing_job:
            request_log.info("dedup.hit", existing_job_id=existing_job)
            return {"job_id": existing_job, "status": "already_queued", "duplicate": True}

    # 2. Rate limiting: check cooldown, daily quota, per-user queue depth
    rl = check_and_consume(sender_hash, estimated_duration_s=0)
    if not rl.allowed:
        request_log.warning("rate_limit.blocked", reason=rl.reason)
        raise HTTPException(429, rl.reason)

    # 3. Save audio to temp
    job_id = str(uuid.uuid4())
    safe_ext = os.path.splitext(audio.filename or "audio.ogg")[1] or ".ogg"
    safe_ext = safe_ext if safe_ext in (".ogg", ".mp3", ".wav", ".m4a", ".opus") else ".ogg"
    temp_path = os.path.join(AUDIO_TEMP_DIR, f"{job_id}{safe_ext}")

    with open(temp_path, "wb") as f:
        shutil.copyfileobj(audio.file, f)

    file_size = os.path.getsize(temp_path)
    if file_size > MAX_SINGLE_AUDIO_MINUTES * 60 * 32000:  # rough upper bound before FFprobe
        os.unlink(temp_path)
        raise HTTPException(413, f"File too large. Max ~{MAX_SINGLE_AUDIO_MINUTES:.0f} min audio.")

    # 4. Record job in DB
    queued_at = datetime.utcnow()
    with get_session() as session:
        session.add(Transcription(
            id=job_id,
            message_id=message_id,
            status="queued",
            language_requested=language,
            queued_at=queued_at,
            created_at=queued_at,
        ))
        session.commit()

    # 5. Dispatch to Celery queue
    task = transcribe_audio.apply_async(
        kwargs={
            "job_id": job_id,
            "audio_path": temp_path,
            "callback_url": callback_url,
            "sender_id": sender_id,
            "sender_hash": sender_hash,
            "requested_language": language,
            "queued_at_ts": time.time(),
        },
        queue="transcription",
    )

    request_log.info("job.queued", job_id=job_id, task_id=task.id, file_size=file_size)
    return {"job_id": job_id, "task_id": task.id, "status": "queued"}


@app.get("/job/{job_id}")
async def get_job(job_id: str):
    with get_session() as session:
        job = session.get(Transcription, job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        return {
            "id": job.id,
            "status": job.status,
            "text": job.text,
            "language_detected": job.language_detected,
            "language_confidence": job.language_confidence,
            "audio_duration_s": job.audio_duration_s,
            "processing_time_s": job.processing_time_s,
            "queue_wait_time_s": job.queue_wait_time_s,
            "chunk_count": job.chunk_count,
            "created_at": job.created_at,
            "completed_at": job.completed_at,
            "error_message": job.error_message,
        }


# ── Admin endpoints ────────────────────────────────────────────────────────────
# Protected by Caddy basicauth — not exposed without auth.

@app.get("/admin/health")
async def admin_system_health():
    """Operational health: queue depth, worker status, Redis, Postgres."""
    r = _redis.Redis.from_url(REDIS_URL)
    try:
        r.ping()
        redis_ok = True
        queue_depth = r.llen("transcription") + r.llen("celery")
    except Exception as e:
        redis_ok = False
        queue_depth = -1

    with get_session() as session:
        try:
            session.execute(text("SELECT 1"))
            db_ok = True
        except Exception:
            db_ok = False

        pending = session.query(func.count(Transcription.id)).filter_by(status="queued").scalar()
        processing = session.query(func.count(Transcription.id)).filter_by(status="processing").scalar()
        failed_last_hour = session.execute(text(
            "SELECT COUNT(*) FROM transcriptions WHERE status='failed' "
            "AND completed_at > NOW() - INTERVAL '1 hour'"
        )).scalar()

    return {
        "redis": {"ok": redis_ok, "queue_depth": queue_depth},
        "postgres": {"ok": db_ok},
        "jobs": {"pending": pending, "processing": processing, "failed_last_hour": failed_last_hour},
    }


@app.get("/admin/stats")
async def admin_stats(days: int = 7):
    """Aggregated transcription stats for the last N days."""
    days = min(days, 90)
    with get_session() as session:
        rows = session.execute(text("""
            SELECT
                DATE(created_at)                                              AS day,
                COUNT(*)                                                      AS total,
                COUNT(*) FILTER (WHERE status = 'done')                       AS success,
                COUNT(*) FILTER (WHERE status = 'failed')                     AS failed,
                ROUND(COALESCE(SUM(audio_duration_s) FILTER (WHERE status='done'), 0) / 60, 1) AS audio_min,
                ROUND(AVG(processing_time_s) FILTER (WHERE status='done'), 2) AS avg_proc_s,
                ROUND(AVG(queue_wait_time_s) FILTER (WHERE status='done'), 2) AS avg_wait_s,
                COUNT(DISTINCT user_id) FILTER (WHERE status='done')          AS unique_users,
                COUNT(*) FILTER (WHERE language_detected='he')                AS lang_he,
                COUNT(*) FILTER (WHERE language_detected='en')                AS lang_en,
                COUNT(*) FILTER (WHERE retry_count > 0)                       AS retried
            FROM transcriptions
            WHERE created_at > NOW() - INTERVAL :days_interval
            GROUP BY day
            ORDER BY day DESC
        """), {"days_interval": f"{days} days"}).fetchall()

        return [dict(r._mapping) for r in rows]


@app.get("/admin/queue")
async def admin_queue():
    """Real-time queue observability."""
    r = _redis.Redis.from_url(REDIS_URL)
    queue_depth = r.llen("transcription") + r.llen("celery")

    with get_session() as session:
        oldest_pending = session.execute(text(
            "SELECT id, queued_at FROM transcriptions "
            "WHERE status='queued' ORDER BY queued_at ASC LIMIT 1"
        )).fetchone()

        recent_latencies = session.execute(text("""
            SELECT
                ROUND(AVG(queue_wait_time_s), 2) AS avg_wait_s,
                ROUND(AVG(processing_time_s), 2)  AS avg_proc_s,
                ROUND(MAX(processing_time_s), 2)  AS max_proc_s,
                COUNT(*)                           AS sample_size
            FROM transcriptions
            WHERE status='done'
            AND completed_at > NOW() - INTERVAL '1 hour'
        """)).fetchone()

    return {
        "queue_depth": queue_depth,
        "oldest_pending": {
            "job_id": oldest_pending[0] if oldest_pending else None,
            "queued_at": oldest_pending[1] if oldest_pending else None,
        },
        "last_hour": dict(recent_latencies._mapping) if recent_latencies else {},
    }


@app.get("/admin/jobs")
async def admin_jobs(limit: int = 50, status: str = None):
    limit = min(limit, 200)
    with get_session() as session:
        q = session.query(Transcription).order_by(Transcription.created_at.desc())
        if status:
            q = q.filter(Transcription.status == status)
        jobs = q.limit(limit).all()
        return [
            {
                "id": j.id,
                "status": j.status,
                "user_id": j.user_id,
                "language_detected": j.language_detected,
                "audio_duration_s": j.audio_duration_s,
                "processing_time_s": j.processing_time_s,
                "queue_wait_time_s": j.queue_wait_time_s,
                "retry_count": j.retry_count,
                "text_preview": (j.text or "")[:120],
                "created_at": j.created_at,
                "completed_at": j.completed_at,
                "error": j.error_message,
            }
            for j in jobs
        ]


@app.get("/admin/users")
async def admin_users(limit: int = 50):
    limit = min(limit, 200)
    with get_session() as session:
        users = (
            session.query(User)
            .order_by(User.total_audio_seconds.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": u.id,
                "total_transcriptions": u.total_transcriptions,
                "total_audio_minutes": round((u.total_audio_seconds or 0) / 60, 1),
                "created_at": u.created_at,
                "last_seen_at": u.last_seen_at,
                "is_active": u.is_active,
                "quota_status": get_user_quota_status(u.id),
            }
            for u in users
        ]


@app.get("/admin/search")
async def admin_search(q: str, limit: int = 20):
    if len(q) < 3:
        raise HTTPException(400, "Query must be at least 3 characters")
    limit = min(limit, 100)
    with get_session() as session:
        results = (
            session.query(Transcription)
            .filter(Transcription.text.ilike(f"%{q}%"))
            .order_by(Transcription.created_at.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": r.id,
                "text": r.text,
                "language_detected": r.language_detected,
                "audio_duration_s": r.audio_duration_s,
                "created_at": r.created_at,
            }
            for r in results
        ]


@app.get("/admin/storage")
async def admin_storage():
    """Disk usage for audio store and temp directories."""
    def dir_stats(path: str) -> dict:
        if not os.path.isdir(path):
            return {"exists": False}
        total_bytes = 0
        file_count = 0
        for root, _, files in os.walk(path):
            for f in files:
                try:
                    total_bytes += os.path.getsize(os.path.join(root, f))
                    file_count += 1
                except OSError:
                    pass
        return {
            "exists": True,
            "files": file_count,
            "size_mb": round(total_bytes / 1024 / 1024, 1),
        }

    return {
        "audio_store": dir_stats(AUDIO_STORE_DIR),
        "audio_temp": dir_stats(AUDIO_TEMP_DIR),
        "retention_days": int(os.environ.get("AUDIO_RETENTION_DAYS", "30")),
    }
