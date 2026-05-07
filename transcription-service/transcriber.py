"""
faster-whisper transcription engine.
Model is loaded once as a singleton to avoid 3GB reload on every job.
"""

import os
from dataclasses import dataclass
from typing import Optional

from faster_whisper import WhisperModel

_model: Optional[WhisperModel] = None


@dataclass
class TranscriptionResult:
    text: str
    language_detected: str
    language_confidence: float
    chunk_count: int


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        model_name = os.environ.get("WHISPER_MODEL", "medium")
        compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
        cpu_threads = int(os.environ.get("WHISPER_THREADS", "3"))
        model_dir = os.environ.get("MODEL_DIR", "/app/models")

        _model = WhisperModel(
            model_name,
            device="cpu",
            compute_type=compute_type,
            cpu_threads=cpu_threads,
            num_workers=1,
            download_root=model_dir,
        )
    return _model


def transcribe_chunks(
    chunk_paths: list[str],
    language: Optional[str],
    initial_prompt: Optional[str] = None,
    beam_size: int = 5,
) -> TranscriptionResult:
    """
    Transcribe a list of audio chunks and join results.
    Tracks the detected language from the first chunk with high confidence.
    """
    model = get_model()
    model_name = os.environ.get("WHISPER_MODEL", "medium")

    texts = []
    best_language = None
    best_confidence = 0.0

    for chunk_path in chunk_paths:
        segments, info = model.transcribe(
            chunk_path,
            language=language,
            initial_prompt=initial_prompt,
            beam_size=beam_size,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400},
        )

        chunk_text = " ".join(seg.text.strip() for seg in segments).strip()
        if chunk_text:
            texts.append(chunk_text)

        if info.language_probability > best_confidence:
            best_confidence = info.language_probability
            best_language = info.language

    full_text = " ".join(texts).strip()

    return TranscriptionResult(
        text=full_text,
        language_detected=best_language or "unknown",
        language_confidence=best_confidence,
        chunk_count=len(chunk_paths),
    )
