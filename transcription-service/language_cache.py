"""
Hybrid language detection with per-user Redis cache.

Strategy:
  1. Check Redis for user's cached language preference
  2. Pass as hint to Whisper (not forced — Whisper still detects)
  3. Update cache only when confidence > 80%
  4. For Hebrew users: language="he" so Whisper keeps English code-switching intact
     (Hebrew speakers mix English words; Whisper handles this well when lang=he)

Cache TTL: 60 days by default (LANG_CACHE_TTL_DAYS env var).
Language preference does not change frequently — 7 days was too short.
"""

import hashlib
import os
from typing import Optional

import redis

_redis_client: Optional[redis.Redis] = None

CACHE_TTL_DAYS = int(os.environ.get("LANG_CACHE_TTL_DAYS", "60"))
CACHE_TTL_SECONDS = CACHE_TTL_DAYS * 24 * 3600
MIN_CONFIDENCE_TO_CACHE = 0.80

HE_INITIAL_PROMPT = "שיחה בעברית ובאנגלית. ייתכן שילוב של שתי השפות."


def get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(
            os.environ["REDIS_URL"], decode_responses=True
        )
    return _redis_client


def hash_sender_id(sender_id: str) -> str:
    return hashlib.sha256(sender_id.encode()).hexdigest()


def get_cached_language(sender_hash: str) -> Optional[str]:
    try:
        return get_redis().get(f"lang:{sender_hash}")
    except Exception:
        return None


def set_cached_language(sender_hash: str, language: str, confidence: float) -> None:
    if confidence < MIN_CONFIDENCE_TO_CACHE:
        return
    try:
        r = get_redis()
        r.setex(f"lang:{sender_hash}", CACHE_TTL_SECONDS, language)
    except Exception:
        pass


def get_transcription_params(sender_hash: str, requested_language: str) -> dict:
    """
    Returns kwargs for model.transcribe() based on user language history.

    When a user consistently speaks Hebrew, we pass language="he" as a hint.
    This allows Whisper to correctly handle code-switched Hebrew+English sentences
    (English words inside Hebrew context are preserved correctly).

    Without this hint, Whisper might detect English and lose Hebrew RTL handling.
    """
    if requested_language and requested_language != "auto":
        lang = requested_language
    else:
        lang = get_cached_language(sender_hash)

    params: dict = {"language": lang, "beam_size": 5, "vad_filter": True}

    if lang == "he":
        params["initial_prompt"] = HE_INITIAL_PROMPT

    return params
