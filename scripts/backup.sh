#!/usr/bin/env bash
# backup.sh — Dump PostgreSQL transcriptions DB to disk
# Schedule via cron: 0 2 * * * /path/to/backup.sh
set -euo pipefail

BASE="/srv/dev-disk-by-uuid-b4a86245-2d95-433f-9294-2551b5080f83/data"
BACKUP_DIR="$BASE/Scripts/whatsapp-transcription/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
OUTPUT="$BACKUP_DIR/transcriptions_$TIMESTAMP.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "Dumping database..."
docker exec transcription-postgres \
    pg_dump -U transcription transcriptions \
    | gzip > "$OUTPUT"

echo "Backup written to: $OUTPUT"

# Keep last 14 backups only
ls -t "$BACKUP_DIR"/transcriptions_*.sql.gz | tail -n +15 | xargs -r rm --
echo "Old backups pruned. Done."
