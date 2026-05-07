#!/usr/bin/env bash
# setup.sh — Create all required directories on the data disk
# Run once on the host before first docker compose up
set -euo pipefail

BASE="/srv/dev-disk-by-uuid-b4a86245-2d95-433f-9294-2551b5080f83/data"
APPDATA="$BASE/docker/appdata"
SCRIPTS="$BASE/Scripts/whatsapp-transcription"
COMPOSE="$BASE/docker/compose/whatsapp-transcription"

echo "Creating directory structure..."

mkdir -p \
    "$APPDATA/evolution-api/instances" \
    "$APPDATA/evolution-api/store" \
    "$APPDATA/transcription/models" \
    "$APPDATA/transcription/audio_temp" \
    "$APPDATA/transcription/logs" \
    "$APPDATA/redis/data" \
    "$APPDATA/postgres/data" \
    "$APPDATA/metabase" \
    "$SCRIPTS/transcription-service" \
    "$COMPOSE"

echo "Setting permissions..."
chmod 700 "$APPDATA/postgres/data"
chmod 750 "$APPDATA/transcription/audio_temp"
chmod 755 "$APPDATA/transcription/models"

echo ""
echo "Next steps:"
echo "  1. Copy .env.example to .env and fill in values:"
echo "     cp $COMPOSE/.env.example $COMPOSE/.env"
echo "  2. Copy transcription-service source to $SCRIPTS/transcription-service/"
echo "  3. From Portainer: deploy stack from $COMPOSE/docker-compose.yml"
echo "  4. Scan WhatsApp QR: https://\$EVOLUTION_DOMAIN/manager"
echo "  5. Import n8n workflow from n8n-workflow.json"
echo ""
echo "Done."
