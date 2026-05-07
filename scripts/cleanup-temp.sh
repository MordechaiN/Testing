#!/usr/bin/env bash
# cleanup-temp.sh — Remove stale audio temp files older than 2 hours
# Run via cron or manually. Celery Beat also does this automatically.
set -euo pipefail

TEMP_DIR="/srv/dev-disk-by-uuid-b4a86245-2d95-433f-9294-2551b5080f83/data/docker/appdata/transcription/audio_temp"
MAX_AGE_MINUTES=120

if [ ! -d "$TEMP_DIR" ]; then
    echo "Temp dir not found: $TEMP_DIR"
    exit 1
fi

COUNT=$(find "$TEMP_DIR" -maxdepth 1 -type f -mmin +"$MAX_AGE_MINUTES" | wc -l)
if [ "$COUNT" -gt 0 ]; then
    echo "Removing $COUNT stale temp files older than ${MAX_AGE_MINUTES}min..."
    find "$TEMP_DIR" -maxdepth 1 -type f -mmin +"$MAX_AGE_MINUTES" -delete
    echo "Done."
else
    echo "No stale temp files found."
fi
