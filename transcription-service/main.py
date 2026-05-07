import os
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from database import DailyStat, Transcription, User, get_session, init_db
from tasks import transcribe_audio
from language_cache import hash_sender_id

AUDIO_TEMP_DIR = os.environ.get("AUDIO_TEMP_DIR", "/app/audio_temp")
MAX_UPLOAD_MB = 50


@asynccontextmanager
async def lifespan(app: FastAPI):
    os.makedirs(AUDIO_TEMP_DIR, exist_ok=True)
    init_db()
    yield


app = FastAPI(title="Transcription Service", lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok", "model": os.environ.get("WHISPER_MODEL", "medium")}


@app.post("/transcribe")
async def submit_transcription(
    audio: UploadFile = File(...),
    sender_id: str = Form(...),
    callback_url: str = Form(None),
    language: str = Form("auto"),
):
    content_length = audio.size or 0
    if content_length > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"Audio file too large (max {MAX_UPLOAD_MB}MB)")

    job_id = str(uuid.uuid4())
    safe_name = f"{job_id}_{audio.filename or 'audio.ogg'}"
    safe_name = "".join(c for c in safe_name if c.isalnum() or c in "._-")
    temp_path = os.path.join(AUDIO_TEMP_DIR, safe_name)

    with open(temp_path, "wb") as f:
        shutil.copyfileobj(audio.file, f)

    sender_hash = hash_sender_id(sender_id)
    queued_at = time.time()

    # Record job in DB immediately
    with get_session() as session:
        from database import Transcription
        session.add(Transcription(
            id=job_id,
            status="queued",
            language_requested=language,
            queued_at=datetime.utcnow(),
            created_at=datetime.utcnow(),
        ))
        session.commit()

    task = transcribe_audio.apply_async(
        kwargs={
            "job_id": job_id,
            "audio_path": temp_path,
            "callback_url": callback_url,
            "sender_id": sender_id,
            "sender_hash": sender_hash,
            "requested_language": language,
            "queued_at_ts": queued_at,
        },
        queue="transcription",
    )

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
            "audio_duration_s": job.audio_duration_s,
            "processing_time_s": job.processing_time_s,
            "queue_wait_time_s": job.queue_wait_time_s,
            "created_at": job.created_at,
            "completed_at": job.completed_at,
            "error_message": job.error_message,
        }


# ── Admin endpoints (protect with Caddy basicauth) ────────────────────────────

@app.get("/admin/stats")
async def admin_stats():
    with get_session() as session:
        from sqlalchemy import func, text

        today = datetime.utcnow().date()
        week_ago = today - timedelta(days=7)

        rows = (
            session.query(DailyStat)
            .filter(DailyStat.stat_date >= week_ago)
            .order_by(DailyStat.stat_date.desc())
            .all()
        )

        # Queue depth
        import redis as _redis
        r = _redis.Redis.from_url(os.environ["REDIS_URL"])
        queue_depth = r.llen("transcription") + r.llen("celery")

        return {
            "queue_depth": queue_depth,
            "daily": [
                {
                    "date": str(r.stat_date),
                    "total": r.total_transcriptions,
                    "success": r.successful_transcriptions,
                    "failed": r.failed_transcriptions,
                    "audio_minutes": round((r.total_audio_seconds or 0) / 60, 1),
                    "avg_processing_s": r.avg_processing_time_s,
                    "avg_queue_wait_s": r.avg_queue_wait_s,
                    "unique_users": r.unique_users,
                    "lang_he": r.language_he_count,
                    "lang_en": r.language_en_count,
                }
                for r in rows
            ],
        }


@app.get("/admin/jobs")
async def admin_jobs(limit: int = 50, status: str = None):
    with get_session() as session:
        q = session.query(Transcription).order_by(Transcription.created_at.desc())
        if status:
            q = q.filter(Transcription.status == status)
        jobs = q.limit(min(limit, 200)).all()
        return [
            {
                "id": j.id,
                "status": j.status,
                "user_id": j.user_id,
                "language_detected": j.language_detected,
                "audio_duration_s": j.audio_duration_s,
                "processing_time_s": j.processing_time_s,
                "text_preview": (j.text or "")[:100],
                "created_at": j.created_at,
                "error": j.error_message,
            }
            for j in jobs
        ]


@app.get("/admin/users")
async def admin_users(limit: int = 50):
    with get_session() as session:
        users = (
            session.query(User)
            .order_by(User.total_audio_seconds.desc())
            .limit(min(limit, 200))
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
            }
            for u in users
        ]


@app.get("/admin/search")
async def admin_search(q: str, limit: int = 20):
    if len(q) < 3:
        raise HTTPException(400, "Query must be at least 3 characters")
    with get_session() as session:
        results = (
            session.query(Transcription)
            .filter(Transcription.text.ilike(f"%{q}%"))
            .order_by(Transcription.created_at.desc())
            .limit(min(limit, 100))
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
