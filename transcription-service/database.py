"""
Database models and helpers.

Design decisions:
  - sender_id stored as BOTH encrypted (for admin/support) and hashed (for indexing/caching)
  - message_id stored for deduplication (WhatsApp sometimes delivers webhooks twice)
  - audio_path stored for retention-based cleanup (audio is kept, not deleted on completion)
  - DailyStat table removed — Metabase queries the transcriptions table directly
  - user_id present on every transcription for future multi-tenant/billing readiness
"""

import os
from datetime import datetime
from typing import Optional

from cryptography.fernet import Fernet
from sqlalchemy import (
    BigInteger, Boolean, Column, DateTime, Float,
    Integer, String, Text, UniqueConstraint, create_engine,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATABASE_URL = os.environ["DATABASE_URL"]
_FERNET_KEY = os.environ.get("ENCRYPTION_KEY", "")

engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=5)
SessionLocal = sessionmaker(bind=engine)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id = Column(String(64), primary_key=True)       # SHA256(sender_id)
    sender_encrypted = Column(Text, nullable=True)   # Fernet-encrypted sender_id (admin only)
    is_active = Column(Boolean, default=True)
    quota_seconds_per_day = Column(Integer, default=7200)  # placeholder for future billing
    total_transcriptions = Column(Integer, default=0)
    total_audio_seconds = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_seen_at = Column(DateTime, default=datetime.utcnow)
    meta = Column(JSONB, default=dict)


class Transcription(Base):
    __tablename__ = "transcriptions"
    __table_args__ = (
        UniqueConstraint("message_id", name="uq_message_id"),
    )

    id = Column(String(36), primary_key=True)        # job UUID
    message_id = Column(String(128), nullable=True)  # WhatsApp message ID (dedup key)
    user_id = Column(String(64), nullable=True)      # FK to users.id
    status = Column(String(20), default="queued")    # queued|processing|done|failed

    text = Column(Text, nullable=True)
    language_requested = Column(String(10), nullable=True)
    language_detected = Column(String(10), nullable=True)
    language_confidence = Column(Float, nullable=True)

    audio_duration_s = Column(Float, nullable=True)
    audio_size_bytes = Column(BigInteger, nullable=True)
    audio_path = Column(Text, nullable=True)         # path to stored audio file
    audio_deleted = Column(Boolean, default=False)   # set True after retention cleanup

    model_used = Column(String(100), nullable=True)
    processing_time_s = Column(Float, nullable=True)
    queue_wait_time_s = Column(Float, nullable=True)
    chunk_count = Column(Integer, nullable=True)
    retry_count = Column(Integer, default=0)

    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    queued_at = Column(DateTime, nullable=True)
    processing_started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    meta = Column(JSONB, default=dict)


def _fernet() -> Optional[Fernet]:
    if _FERNET_KEY:
        return Fernet(_FERNET_KEY.encode() if isinstance(_FERNET_KEY, str) else _FERNET_KEY)
    return None


def encrypt_sender(sender_id: str) -> Optional[str]:
    f = _fernet()
    if f:
        return f.encrypt(sender_id.encode()).decode()
    return None


def decrypt_sender(encrypted: str) -> Optional[str]:
    f = _fernet()
    if f and encrypted:
        try:
            return f.decrypt(encrypted.encode()).decode()
        except Exception:
            return None
    return None


def init_db():
    Base.metadata.create_all(engine)


def get_session() -> Session:
    return SessionLocal()


def upsert_user(session: Session, sender_id: str, sender_hash: str) -> str:
    user = session.get(User, sender_hash)
    if not user:
        user = User(
            id=sender_hash,
            sender_encrypted=encrypt_sender(sender_id),
        )
        session.add(user)
    user.last_seen_at = datetime.utcnow()
    session.commit()
    return sender_hash


def message_already_processed(session: Session, message_id: str) -> Optional[str]:
    """Returns existing job_id if this message_id was already queued, else None."""
    if not message_id:
        return None
    row = session.query(Transcription.id).filter_by(message_id=message_id).first()
    return row[0] if row else None


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
    audio_path: str,
    processing_time_s: float,
    queue_wait_time_s: float,
    chunk_count: int,
    model_used: str,
    processing_started_at: datetime,
    retry_count: int = 0,
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
        "audio_path": audio_path,
        "processing_time_s": processing_time_s,
        "queue_wait_time_s": queue_wait_time_s,
        "chunk_count": chunk_count,
        "model_used": model_used,
        "processing_started_at": processing_started_at,
        "completed_at": datetime.utcnow(),
        "retry_count": retry_count,
    })
    session.query(User).filter_by(id=user_id).update({
        "total_transcriptions": User.total_transcriptions + 1,
        "total_audio_seconds": User.total_audio_seconds + (audio_duration_s or 0),
    })
    session.commit()


def save_transcription_error(session: Session, job_id: str, error: str, retry_count: int = 0):
    session.query(Transcription).filter_by(id=job_id).update({
        "status": "failed",
        "error_message": error[:1000],
        "completed_at": datetime.utcnow(),
        "retry_count": retry_count,
    })
    session.commit()


def get_audio_paths_for_cleanup(session: Session, older_than_days: int) -> list[tuple[str, str]]:
    """Returns [(job_id, audio_path)] for audio files ready to be deleted."""
    from datetime import timedelta
    cutoff = datetime.utcnow() - timedelta(days=older_than_days)
    rows = (
        session.query(Transcription.id, Transcription.audio_path)
        .filter(
            Transcription.audio_path.isnot(None),
            Transcription.audio_deleted.is_(False),
            Transcription.completed_at < cutoff,
        )
        .all()
    )
    return [(r.id, r.audio_path) for r in rows]


def mark_audio_deleted(session: Session, job_ids: list[str]):
    session.query(Transcription).filter(Transcription.id.in_(job_ids)).update(
        {"audio_deleted": True, "audio_path": None},
        synchronize_session=False,
    )
    session.commit()
