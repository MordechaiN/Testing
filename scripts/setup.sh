#!/usr/bin/env bash
# setup.sh — Prepare directories and DB for the transcription system.
# Assumes the existing wa_llm stack (wa_llm_postgres, wa_llm_whatsapp) is already running.
set -euo pipefail

BASE="/srv/dev-disk-by-uuid-b4a86245-2d95-433f-9294-2551b5080f83/data"
APPDATA="$BASE/docker/appdata"
SCRIPTS="$BASE/Scripts/whatsapp-transcription"
COMPOSE="$BASE/docker/compose/whatsapp-transcription"

echo "=== Creating directory structure ==="
mkdir -p \
    "$APPDATA/transcription/models" \
    "$APPDATA/transcription/audio_temp" \
    "$APPDATA/transcription/audio_store" \
    "$APPDATA/transcription/redis" \
    "$APPDATA/transcription/logs" \
    "$APPDATA/metabase" \
    "$SCRIPTS/transcription-service" \
    "$SCRIPTS/backups" \
    "$COMPOSE"

chmod 750 "$APPDATA/transcription/audio_temp"
chmod 750 "$APPDATA/transcription/audio_store"
chmod 755 "$APPDATA/transcription/models"

echo ""
echo "=== Creating 'transcriptions' database in existing wa_llm_postgres ==="
echo "Enter your wa_llm_user password when prompted:"

docker exec -it wa_llm_postgres psql -U wa_llm_user -d wa_llm \
    -c "CREATE DATABASE transcriptions;" 2>/dev/null || echo "(database may already exist — OK)"

docker exec -it wa_llm_postgres psql -U wa_llm_user \
    -c "GRANT ALL ON DATABASE transcriptions TO wa_llm_user;" 2>/dev/null || true

echo ""
echo "=== Updating go-whatsapp webhook ==="
echo "Change WHATSAPP_WEBHOOK in your wa_llm docker-compose.yml to:"
echo "  WHATSAPP_WEBHOOK=http://n8n:5678/webhook/whatsapp"
echo "Then: docker compose up -d whatsapp"

echo ""
echo "=== Next steps ==="
echo "  1. Copy and fill .env:"
echo "     cp $COMPOSE/.env.example $COMPOSE/.env && nano $COMPOSE/.env"
echo ""
echo "  2. Generate secrets:"
echo "     ENCRYPTION_KEY: python3 -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
echo ""
echo "  3. Deploy via Portainer → Stacks → $COMPOSE/docker-compose.yml"
echo ""
echo "  4. Import n8n workflow from: $SCRIPTS/n8n-workflow.json"
echo "     Add n8n env var: WA_BASIC_AUTH=MordechaiN:YOUR_WHATSAPP_PASSWORD"
echo ""
echo "  5. Set n8n webhook timeout to 300s:"
echo "     n8n env: EXECUTIONS_TIMEOUT=300"
echo ""
echo "Done."
