"""
Structured JSON logging.
Every log line is a JSON object — ready for ELK, Loki, or grep.

Usage:
    from logging_config import get_logger
    log = get_logger(__name__)
    log.info("transcription.done", job_id=job_id, duration_s=2.3, language="he")
"""

import json
import logging
import os
import sys
import time
from typing import Any


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        # Merge any extra fields passed via log.info("msg", extra={...})
        for key, val in record.__dict__.items():
            if key not in (
                "args", "created", "exc_info", "exc_text", "filename",
                "funcName", "levelname", "levelno", "lineno", "message",
                "module", "msecs", "msg", "name", "pathname", "process",
                "processName", "relativeCreated", "stack_info", "taskName",
                "thread", "threadName",
            ):
                base[key] = val

        if record.exc_info:
            base["exc"] = self.formatException(record.exc_info)

        return json.dumps(base, ensure_ascii=False, default=str)


def _setup():
    root = logging.getLogger()
    if root.handlers:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())
    level = os.environ.get("LOG_LEVEL", "INFO").upper()
    root.setLevel(getattr(logging, level, logging.INFO))
    root.addHandler(handler)
    # Suppress noisy libraries
    for noisy in ("httpx", "httpcore", "multipart", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


_setup()


class _BoundLogger:
    """Logger that carries fixed context fields on every call."""

    def __init__(self, name: str, **ctx):
        self._logger = logging.getLogger(name)
        self._ctx = ctx

    def _log(self, level: int, msg: str, **kw):
        extra = {**self._ctx, **kw}
        self._logger.log(level, msg, extra=extra)

    def debug(self, msg: str, **kw): self._log(logging.DEBUG, msg, **kw)
    def info(self, msg: str, **kw):  self._log(logging.INFO, msg, **kw)
    def warning(self, msg: str, **kw): self._log(logging.WARNING, msg, **kw)
    def error(self, msg: str, **kw): self._log(logging.ERROR, msg, **kw)

    def bind(self, **kw) -> "_BoundLogger":
        return _BoundLogger(self._logger.name, **{**self._ctx, **kw})


def get_logger(name: str, **ctx) -> _BoundLogger:
    return _BoundLogger(name, **ctx)
