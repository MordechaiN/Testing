import hashlib
import os
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    BigInteger, Boolean, Column, Date, DateTime, Float, Integer,
    String, Text, create_engine, func, text
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATABASE_URL = os.environ["DATABASE_URL"]

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=5)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(String(64), primary_key=True)  # SHA256 of phone number
    phone_hash = Column(String(64), unique=True, nullable=False)
    display_name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    quota_seconds_per_day = Column(Integer, default=7200)
    total_transcriptions = Column(Integer, default=0)
    total_audio_seconds = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen_at = Column(DateTime, default=datetime.utcnow)
    metadata_ = Column("metadata", JSONB, default=dict)


class Transcription(Base):
    __tablename__ = "transcriptions"

    id = Column(String(36), primary_key=True)  # UUID
    user_id = Column(String(64), nullable=True)  # FK to users.id (nullable for unknown senders)
    status = Column(String(20), default="queued")  # queued|processing|done|failed
    text = Column(Text, nullable=True)
    language_requested = Column(String(10), nullable=True)  # "auto" or "he"/"en"
    language_detected = Column(String(10), nullable=True)
    language_confidence = Column(Float, nullable=True)
    audio_duration_s = Column(Float, nullable=True)
    audio_size_bytes = Column(BigInteger, nullable=True)
    model_used = Column(String(100), nullable=True)
    processing_time_s = Column(Float, nullable=True)
    queue_wait_time_s = Column(Float, nullable=True)
    chunk_count = Column(Integer, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    queued_at = Column(DateTime, nullable=True)
    processing_started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    metadata_ = Column("metadata", JSONB, default=dict)


class DailyStat(Base):
    __tablename__ = "daily_stats"

    stat_date = Column(Date, primary_key=True)
    total_transcriptions = Column(Integer, default=0)
    successful_transcriptions = Column(Integer, default=0)
    failed_transcriptions = Column(Integer, default=0)
    total_audio_seconds = Column(Float, default=0.0)
    avg_processing_time_s = Column(Float, nullable=True)
    avg_queue_wait_s = Column(Float, nullable=True)
    unique_users = Column(Integer, default=0)
    language_he_count = Column(Integer, default=0)
    language_en_count = Column(Integer, default=0)
    language_other_count = Column(Integer, default=0)


def hash_sender_id(sender_id: str) -> str:
    return hashlib.sha256(sender_id.encode()).hexdigest()


def init_db():
    Base.metadata.create_all(engine)


def get_session() -> Session:
    return SessionLocal()


def upsert_user(session: Session, sender_id: str) -> str:
    user_id = hash_sender_id(sender_id)
    user = session.get(User, user_id)
    if not user:
        user = User(id=user_id, phone_hash=user_id)
        session.add(user)
    user.last_seen_at = datetime.utcnow()
    session.commit()
    return user_id


def save_transcription_result(
    session: Session,
    job_id: str,
    user_id: str,
    text: str,
    lang_requested: str,
    lang_detected: str,
    lang_confidence: float,
    audio_duration_s: float,
    audio_size_bytes: int,
    processing_time_s: float,
    queue_wait_time_s: float,
    chunk_count: int,
    model_used: str,
    processing_started_at: datetime,
):
    session.query(Transcription).filter_by(id=job_id).update({
        "status": "done",
        "user_id": user_id,
        "text": text,
        "language_requested": lang_requested,
        "language_detected": lang_detected,
        "language_confidence": lang_confidence,
        "audio_duration_s": audio_duration_s,
        "audio_size_bytes": audio_size_bytes,
        "processing_time_s": processing_time_s,
        "queue_wait_time_s": queue_wait_time_s,
        "chunk_count": chunk_count,
        "model_used": model_used,
        "processing_started_at": processing_started_at,
        "completed_at": datetime.utcnow(),
    })

    # Update user totals
    session.query(User).filter_by(id=user_id).update({
        "total_transcriptions": User.total_transcriptions + 1,
        "total_audio_seconds": User.total_audio_seconds + audio_duration_s,
    })

    session.commit()


def save_transcription_error(session: Session, job_id: str, error: str):
    session.query(Transcription).filter_by(id=job_id).update({
        "status": "failed",
        "error_message": error[:1000],
        "completed_at": datetime.utcnow(),
    })
    session.commit()


def aggregate_daily_stats(session: Session, stat_date: Optional[date] = None):
    if stat_date is None:
        stat_date = date.today()

    result = session.execute(text("""
        SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status = 'done') AS success,
            COUNT(*) FILTER (WHERE status = 'failed') AS failed,
            COALESCE(SUM(audio_duration_s) FILTER (WHERE status = 'done'), 0) AS total_audio,
            AVG(processing_time_s) FILTER (WHERE status = 'done') AS avg_proc,
            AVG(queue_wait_time_s) FILTER (WHERE status = 'done') AS avg_wait,
            COUNT(DISTINCT user_id) FILTER (WHERE status = 'done') AS unique_users,
            COUNT(*) FILTER (WHERE language_detected = 'he') AS lang_he,
            COUNT(*) FILTER (WHERE language_detected = 'en') AS lang_en,
            COUNT(*) FILTER (WHERE language_detected NOT IN ('he', 'en') AND language_detected IS NOT NULL) AS lang_other
        FROM transcriptions
        WHERE DATE(created_at) = :d
    """), {"d": stat_date}).fetchone()

    existing = session.get(DailyStat, stat_date)
    if not existing:
        existing = DailyStat(stat_date=stat_date)
        session.add(existing)

    existing.total_transcriptions = result.total
    existing.successful_transcriptions = result.success
    existing.failed_transcriptions = result.failed
    existing.total_audio_seconds = float(result.total_audio or 0)
    existing.avg_processing_time_s = float(result.avg_proc) if result.avg_proc else None
    existing.avg_queue_wait_s = float(result.avg_wait) if result.avg_wait else None
    existing.unique_users = result.unique_users
    existing.language_he_count = result.lang_he
    existing.language_en_count = result.lang_en
    existing.language_other_count = result.lang_other

    session.commit()
