"""
Audio preprocessing pipeline:
  OGG/OPUS → WAV 16kHz mono → Silero VAD → chunks on silence boundaries
"""

import os
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

import numpy as np

_vad_model = None
_vad_utils = None
CHUNK_DURATION_S = 25
MIN_SILENCE_MS = 400
VAD_THRESHOLD = 0.5
SAMPLE_RATE = 16000


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


def convert_to_wav(input_path: str, output_path: str) -> None:
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", input_path,
            "-ar", str(SAMPLE_RATE),
            "-ac", "1",
            "-c:a", "pcm_s16le",
            output_path,
        ],
        capture_output=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(f"FFmpeg failed: {result.stderr.decode()[:500]}")


def get_audio_duration(wav_path: str) -> float:
    result = subprocess.run(
        [
            "ffprobe", "-v", "quiet", "-print_format", "json",
            "-show_streams", wav_path,
        ],
        capture_output=True,
        timeout=30,
    )
    import json
    data = json.loads(result.stdout)
    for stream in data.get("streams", []):
        if stream.get("codec_type") == "audio":
            return float(stream.get("duration", 0))
    return 0.0


def _load_wav_as_tensor(wav_path: str):
    import torch
    import torchaudio

    waveform, sr = torchaudio.load(wav_path)
    if sr != SAMPLE_RATE:
        waveform = torchaudio.functional.resample(waveform, sr, SAMPLE_RATE)
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    return waveform.squeeze(0)


def _get_speech_timestamps(audio_tensor) -> list:
    import torch
    model, utils = _get_vad()
    get_speech_ts = utils[0]
    return get_speech_ts(
        audio_tensor,
        model,
        sampling_rate=SAMPLE_RATE,
        threshold=VAD_THRESHOLD,
        min_silence_duration_ms=MIN_SILENCE_MS,
    )


def split_into_chunks(wav_path: str, temp_dir: str) -> list[str]:
    """
    Split audio into chunks of ~CHUNK_DURATION_S seconds,
    cutting only on silence boundaries detected by Silero VAD.
    Returns list of chunk file paths.
    """
    import torch
    import torchaudio

    audio = _load_wav_as_tensor(wav_path)
    speech_timestamps = _get_speech_timestamps(audio)

    if not speech_timestamps:
        return []

    # Merge timestamps into chunks under CHUNK_DURATION_S
    chunks = []
    current_start = speech_timestamps[0]["start"]
    current_end = speech_timestamps[0]["end"]

    for ts in speech_timestamps[1:]:
        proposed_end = ts["end"]
        duration_samples = proposed_end - current_start
        duration_s = duration_samples / SAMPLE_RATE

        if duration_s <= CHUNK_DURATION_S:
            current_end = proposed_end
        else:
            chunks.append((current_start, current_end))
            current_start = ts["start"]
            current_end = ts["end"]

    chunks.append((current_start, current_end))

    # Export each chunk with padding
    PADDING_SAMPLES = int(0.1 * SAMPLE_RATE)
    chunk_paths = []

    for i, (start, end) in enumerate(chunks):
        padded_start = max(0, start - PADDING_SAMPLES)
        padded_end = min(len(audio), end + PADDING_SAMPLES)
        chunk_audio = audio[padded_start:padded_end].unsqueeze(0)

        chunk_path = os.path.join(temp_dir, f"chunk_{i:03d}.wav")
        torchaudio.save(chunk_path, chunk_audio, SAMPLE_RATE)
        chunk_paths.append(chunk_path)

    return chunk_paths


def normalize_audio(wav_path: str) -> None:
    """Normalize amplitude in-place using ffmpeg loudnorm filter."""
    tmp = wav_path + ".norm.wav"
    result = subprocess.run(
        [
            "ffmpeg", "-y", "-i", wav_path,
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            "-ar", str(SAMPLE_RATE), "-ac", "1",
            tmp,
        ],
        capture_output=True,
        timeout=120,
    )
    if result.returncode == 0:
        os.replace(tmp, wav_path)
    else:
        if os.path.exists(tmp):
            os.unlink(tmp)


def process_audio(input_path: str) -> tuple[str, list[str], float, int]:
    """
    Full preprocessing pipeline.
    Returns: (wav_path, chunk_paths, duration_s, file_size_bytes)
    """
    temp_dir = os.path.dirname(input_path)
    base = os.path.splitext(os.path.basename(input_path))[0]
    wav_path = os.path.join(temp_dir, f"{base}.wav")

    audio_size_bytes = os.path.getsize(input_path)

    convert_to_wav(input_path, wav_path)
    duration_s = get_audio_duration(wav_path)

    # Normalize AFTER conversion (not before VAD — VAD works better on raw audio)
    chunk_paths = split_into_chunks(wav_path, temp_dir)

    # Normalize each chunk for consistent Whisper input
    for chunk in chunk_paths:
        normalize_audio(chunk)

    # If VAD found nothing (silence-only message)
    if not chunk_paths:
        chunk_paths = [wav_path]

    return wav_path, chunk_paths, duration_s, audio_size_bytes


def cleanup_files(*paths: str) -> None:
    for p in paths:
        if p and os.path.exists(p):
            try:
                os.unlink(p)
            except OSError:
                pass
