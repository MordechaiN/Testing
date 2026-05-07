"""
Audio preprocessing pipeline:
  OGG/OPUS → WAV 16kHz mono → Silero VAD → chunks on silence boundaries

Audio retention:
  - temp files (WAV conversion, chunks) → deleted after transcription
  - original input file → moved to AUDIO_STORE_DIR, kept for AUDIO_RETENTION_DAYS
  - retention cleanup runs nightly via Celery Beat
"""

import os
import shutil
import subprocess
from datetime import datetime

from logging_config import get_logger

log = get_logger(__name__)

CHUNK_DURATION_S = 25
MIN_SILENCE_MS = 400
VAD_THRESHOLD = 0.5
SAMPLE_RATE = 16000

AUDIO_TEMP_DIR = os.environ.get("AUDIO_TEMP_DIR", "/app/audio_temp")
AUDIO_STORE_DIR = os.environ.get("AUDIO_STORE_DIR", "/app/audio_store")
MAX_SINGLE_AUDIO_MINUTES = float(os.environ.get("MAX_SINGLE_AUDIO_MINUTES", "10"))

_vad_model = None
_vad_utils = None


def _get_vad():
    global _vad_model, _vad_utils
    if _vad_model is None:
        import torch
        _vad_model, _vad_utils = torch.hub.load(
            repo_or_dir="snakers4/silero-vad",
            model="silero_vad",
            force_reload=False,
        )
    return _vad_model, _vad_utils


def get_audio_info(file_path: str) -> tuple[float, int]:
    """Returns (duration_seconds, file_size_bytes)."""
    import json
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", file_path],
        capture_output=True, timeout=30,
    )
    size = os.path.getsize(file_path)
    try:
        data = json.loads(result.stdout)
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "audio":
                return float(stream.get("duration", 0)), size
    except Exception:
        pass
    return 0.0, size


def validate_audio_length(duration_s: float) -> None:
    max_s = MAX_SINGLE_AUDIO_MINUTES * 60
    if duration_s > max_s:
        raise ValueError(
            f"Audio duration {duration_s:.0f}s exceeds maximum {max_s:.0f}s "
            f"({MAX_SINGLE_AUDIO_MINUTES:.0f} min)"
        )


def store_original_audio(input_path: str, job_id: str) -> str:
    """
    Move original audio file to the long-term audio store directory.
    Returns the new stored path.
    """
    os.makedirs(AUDIO_STORE_DIR, exist_ok=True)
    # Organise by YYYY/MM to avoid flat directory explosion
    date_prefix = datetime.utcnow().strftime("%Y/%m")
    dest_dir = os.path.join(AUDIO_STORE_DIR, date_prefix)
    os.makedirs(dest_dir, exist_ok=True)

    ext = os.path.splitext(input_path)[1] or ".ogg"
    dest = os.path.join(dest_dir, f"{job_id}{ext}")
    shutil.copy2(input_path, dest)
    return dest


def convert_to_wav(input_path: str, output_path: str) -> None:
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", input_path,
            "-ar", str(SAMPLE_RATE), "-ac", "1",
            "-c:a", "pcm_s16le", output_path,
        ],
        capture_output=True, timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg conversion failed: {result.stderr.decode()[:400]}")


def _load_wav_as_tensor(wav_path: str):
    import torchaudio
    waveform, sr = torchaudio.load(wav_path)
    if sr != SAMPLE_RATE:
        import torchaudio.functional as F
        waveform = F.resample(waveform, sr, SAMPLE_RATE)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    return waveform.squeeze(0)


def _get_speech_timestamps(audio_tensor) -> list:
    model, utils = _get_vad()
    get_speech_ts = utils[0]
    return get_speech_ts(
        audio_tensor, model,
        sampling_rate=SAMPLE_RATE,
        threshold=VAD_THRESHOLD,
        min_silence_duration_ms=MIN_SILENCE_MS,
    )


def split_into_chunks(wav_path: str, temp_dir: str) -> list[str]:
    """
    Split audio on silence boundaries into chunks ≤ CHUNK_DURATION_S.
    Returns list of chunk WAV file paths (in temp_dir, deleted after transcription).
    """
    import torchaudio
    audio = _load_wav_as_tensor(wav_path)
    speech_timestamps = _get_speech_timestamps(audio)

    if not speech_timestamps:
        log.warning("audio.vad.empty", wav_path=wav_path)
        return []

    # Merge speech segments into chunks under CHUNK_DURATION_S seconds
    chunks: list[tuple[int, int]] = []
    start = speech_timestamps[0]["start"]
    end = speech_timestamps[0]["end"]

    for ts in speech_timestamps[1:]:
        if (ts["end"] - start) / SAMPLE_RATE <= CHUNK_DURATION_S:
            end = ts["end"]
        else:
            chunks.append((start, end))
            start = ts["start"]
            end = ts["end"]
    chunks.append((start, end))

    PADDING = int(0.1 * SAMPLE_RATE)
    chunk_paths = []

    for i, (s, e) in enumerate(chunks):
        chunk = audio[max(0, s - PADDING): min(len(audio), e + PADDING)].unsqueeze(0)
        path = os.path.join(temp_dir, f"chunk_{i:03d}.wav")
        torchaudio.save(path, chunk, SAMPLE_RATE)
        chunk_paths.append(path)

    log.info("audio.split", chunk_count=len(chunk_paths), wav_path=wav_path)
    return chunk_paths


def normalize_audio(wav_path: str) -> None:
    tmp = wav_path + ".norm.wav"
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", wav_path,
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-ar", str(SAMPLE_RATE), "-ac", "1", tmp,
        ],
        capture_output=True, timeout=120,
    )
    if result.returncode == 0:
        os.replace(tmp, wav_path)
    elif os.path.exists(tmp):
        os.unlink(tmp)


def process_audio(input_path: str, job_id: str) -> tuple[str, str, list[str], float, int]:
    """
    Full preprocessing pipeline.

    Returns:
        stored_audio_path  — long-term path of the original audio (for retention)
        wav_path           — temp WAV (delete after transcription)
        chunk_paths        — temp chunk WAVs (delete after transcription)
        duration_s
        audio_size_bytes
    """
    temp_dir = os.path.dirname(input_path)
    base = os.path.splitext(os.path.basename(input_path))[0]

    duration_s, audio_size = get_audio_info(input_path)
    validate_audio_length(duration_s)

    # Store original before any conversion (copy, not move — original still at input_path)
    stored_path = store_original_audio(input_path, job_id)
    log.info("audio.stored", job_id=job_id, stored_path=stored_path, duration_s=duration_s)

    wav_path = os.path.join(temp_dir, f"{base}.wav")
    convert_to_wav(input_path, wav_path)

    chunk_paths = split_into_chunks(wav_path, temp_dir)

    if not chunk_paths:
        # Silence-only audio: transcribe whole file
        normalize_audio(wav_path)
        chunk_paths = [wav_path]
    else:
        for cp in chunk_paths:
            normalize_audio(cp)

    return stored_path, wav_path, chunk_paths, duration_s, audio_size


def cleanup_temp_files(*paths: str) -> None:
    """Delete temp files (WAV + chunks). Does NOT delete stored audio."""
    for p in paths:
        if p and os.path.exists(p):
            try:
                os.unlink(p)
            except OSError:
                pass


def cleanup_stored_audio_older_than(days: int) -> int:
    """
    Walk AUDIO_STORE_DIR and delete files older than `days`.
    Returns count of deleted files.
    Called by Celery Beat task.
    """
    import time
    cutoff = time.time() - days * 86400
    deleted = 0
    for root, _, files in os.walk(AUDIO_STORE_DIR):
        for fname in files:
            fpath = os.path.join(root, fname)
            try:
                if os.path.getmtime(fpath) < cutoff:
                    os.unlink(fpath)
                    deleted += 1
            except OSError:
                pass
    return deleted
