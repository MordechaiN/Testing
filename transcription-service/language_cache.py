"""
Hybrid language detection with per-user Redis cache.

Logic:
  1. Check Redis for cached language preference per sender
  2. Pass as hint (not force) to Whisper
  3. After transcription, update cache based on detected language + confidence
  4. For Hebrew users: language="he" so Whisper keeps English code-switching intact

Cache key: lang:{sender_hash}
TTL: 7 days (refreshed on every confident detection)
"""

import os
from typing import Optional

import redis

_redis_client: Optional[redis.Redis] = None
CACHE_TTL_SECONDS = 7 * 24 * 3600
MIN_CONFIDENCE_TO_CACHE = 0.80
HE_INITIAL_PROMPT = "שיחה בעברית ובאנגלית. ייתכן שילוב של שתי השפות."


def get_redis() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(
            os.environ["REDIS_URL"], decode_responses=True
        )
    return _redis_client


def get_cached_language(sender_hash: str) -> Optional[str]:
    try:
        return get_redis().get(f"lang:{sender_hash}")
    except Exception:
        return None


def set_cached_language(sender_hash: str, language: str, confidence: float) -> None:
    if confidence < MIN_CONFIDENCE_TO_CACHE:
        return
    try:
        get_redis().setex(f"lang:{sender_hash}", CACHE_TTL_SECONDS, language)
    except Exception:
        pass


def get_transcription_params(sender_hash: str, requested_language: str) -> dict:
    """
    Returns kwargs for model.transcribe() based on user history.

    For Hebrew users: pass language="he" so Whisper keeps English words intact
    in code-switched sentences. Without this, Whisper might detect English and
    fail to handle Hebrew RTL characters properly.

    For unknown users: use auto-detect (language=None).
    """
    if requested_language and requested_language != "auto":
        lang = requested_language
    else:
        lang = get_cached_language(sender_hash)

    params = {"language": lang, "beam_size": 5, "vad_filter": True}

    if lang == "he":
        params["initial_prompt"] = HE_INITIAL_PROMPT

    return params
