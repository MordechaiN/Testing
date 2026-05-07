"""
Per-user rate limiting via Redis.

Limits (all configurable via env):
  MAX_AUDIO_MINUTES_PER_DAY  — total audio minutes a user can transcribe per day
  MAX_QUEUE_PER_USER         — max jobs a user can have waiting in queue at once
  COOLDOWN_SECONDS           — minimum gap between consecutive requests
  MAX_SINGLE_AUDIO_MINUTES   — single audio file max length (rejected before queueing)
"""

import os
import time
from dataclasses import dataclass

import redis as _redis

MAX_AUDIO_MINUTES_PER_DAY = float(os.environ.get("MAX_AUDIO_MINUTES_PER_DAY", "120"))
MAX_QUEUE_PER_USER = int(os.environ.get("MAX_QUEUE_PER_USER", "5"))
COOLDOWN_SECONDS = float(os.environ.get("COOLDOWN_SECONDS", "3"))
MAX_SINGLE_AUDIO_MINUTES = float(os.environ.get("MAX_SINGLE_AUDIO_MINUTES", "10"))

_redis_client = None


def _r() -> _redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = _redis.Redis.from_url(
            os.environ["REDIS_URL"], decode_responses=True
        )
    return _redis_client


@dataclass
class RateLimitResult:
    allowed: bool
    reason: str = ""


def check_single_audio_length(duration_s: float) -> RateLimitResult:
    max_s = MAX_SINGLE_AUDIO_MINUTES * 60
    if duration_s > max_s:
        return RateLimitResult(
            False,
            f"Audio too long ({duration_s:.0f}s). Max {MAX_SINGLE_AUDIO_MINUTES:.0f} minutes."
        )
    return RateLimitResult(True)


def check_and_consume(user_hash: str, estimated_duration_s: float = 0) -> RateLimitResult:
    """
    Check all rate limits for this user and consume the slot if allowed.
    Call this BEFORE queuing a job.
    """
    r = _r()
    now = time.time()
    today = time.strftime("%Y%m%d")

    # 1. Cooldown check
    cooldown_key = f"cooldown:{user_hash}"
    last_ts = r.get(cooldown_key)
    if last_ts and (now - float(last_ts)) < COOLDOWN_SECONDS:
        wait = COOLDOWN_SECONDS - (now - float(last_ts))
        return RateLimitResult(False, f"Too fast. Wait {wait:.1f}s before next request.")

    # 2. Daily quota check
    quota_key = f"quota:{user_hash}:day:{today}"
    used_s = float(r.get(quota_key) or 0)
    max_s = MAX_AUDIO_MINUTES_PER_DAY * 60
    if used_s >= max_s:
        return RateLimitResult(
            False,
            f"Daily quota reached ({MAX_AUDIO_MINUTES_PER_DAY:.0f} min/day)."
        )

    # 3. Per-user queue depth check
    queue_key = f"userqueue:{user_hash}"
    queue_depth = int(r.get(queue_key) or 0)
    if queue_depth >= MAX_QUEUE_PER_USER:
        return RateLimitResult(
            False,
            f"Too many pending jobs ({queue_depth}). Max {MAX_QUEUE_PER_USER}."
        )

    # All checks passed — consume slots atomically
    pipe = r.pipeline()
    pipe.setex(cooldown_key, int(COOLDOWN_SECONDS) + 2, now)
    pipe.incrbyfloat(quota_key, max(estimated_duration_s, 1))
    pipe.expire(quota_key, 90000)  # 25 hours — survives midnight by 1 hour
    pipe.incr(queue_key)
    pipe.expire(queue_key, 3600)
    pipe.execute()

    return RateLimitResult(True)


def release_queue_slot(user_hash: str):
    """Call when a job finishes (success or failure) to free the queue slot."""
    r = _r()
    key = f"userqueue:{user_hash}"
    current = int(r.get(key) or 0)
    if current > 0:
        r.decr(key)


def add_used_seconds(user_hash: str, actual_duration_s: float, estimated_duration_s: float = 0):
    """
    Correct the daily quota with the actual audio duration.
    Called after transcription completes.
    """
    diff = actual_duration_s - max(estimated_duration_s, 1)
    if abs(diff) < 0.5:
        return
    today = time.strftime("%Y%m%d")
    quota_key = f"quota:{user_hash}:day:{today}"
    _r().incrbyfloat(quota_key, diff)


def get_user_quota_status(user_hash: str) -> dict:
    r = _r()
    today = time.strftime("%Y%m%d")
    used_s = float(r.get(f"quota:{user_hash}:day:{today}") or 0)
    queue_depth = int(r.get(f"userqueue:{user_hash}") or 0)
    return {
        "used_minutes_today": round(used_s / 60, 1),
        "max_minutes_today": MAX_AUDIO_MINUTES_PER_DAY,
        "queue_depth": queue_depth,
        "max_queue": MAX_QUEUE_PER_USER,
    }
