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
    "$APPDATA/transcription/audio_store" \
    "$APPDATA/transcription/logs" \
    "$APPDATA/redis/data" \
    "$APPDATA/postgres/data" \
    "$APPDATA/metabase" \
    "$SCRIPTS/transcription-service" \
    "$SCRIPTS/backups" \
    "$COMPOSE"

echo "Setting permissions..."
chmod 700 "$APPDATA/postgres/data"
chmod 750 "$APPDATA/transcription/audio_temp"
chmod 750 "$APPDATA/transcription/audio_store"
chmod 755 "$APPDATA/transcription/models"

echo ""
echo "Next steps:"
echo "  1. Copy and fill .env:"
echo "     cp $COMPOSE/.env.example $COMPOSE/.env && nano $COMPOSE/.env"
echo ""
echo "  2. Generate required secrets:"
echo "     EVOLUTION_API_KEY: openssl rand -hex 32"
echo "     POSTGRES_PASSWORD: openssl rand -base64 24"
echo "     ENCRYPTION_KEY:    python3 -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
echo ""
echo "  3. Copy source code:"
echo "     cp -r /path/to/repo/transcription-service/ $SCRIPTS/"
echo ""
echo "  4. Deploy via Portainer → Stacks → Add Stack → from $COMPOSE/docker-compose.yml"
echo "  5. Scan WhatsApp QR at https://\$EVOLUTION_DOMAIN/manager"
echo "  6. Import n8n workflow from scripts/n8n-workflow.json"
echo ""
echo "Done."
