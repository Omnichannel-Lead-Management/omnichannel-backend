#!/usr/bin/env bash
# Run on the server from ~/omnichannel/omnichannel-backend/deployment
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

LOCK_FILE="/tmp/omnichannel-deploy.lock"
exec 9>"$LOCK_FILE"
if ! flock -w 600 9; then
  echo "Could not acquire deploy lock within 10 minutes."
  exit 1
fi

SERVICES=("$@")
if [[ ${#SERVICES[@]} -eq 0 ]]; then
  SERVICES=(gateway routing chatbot appointment dashboard edge)
fi

if [[ ! -f .env ]]; then
  echo "Missing $ROOT/.env — create it from .env.example before deploying."
  exit 1
fi

# Clean leftover rename conflicts from interrupted compose recreates.
docker ps -a --format '{{.Names}}' | grep -E '^[0-9a-f]+_omnichannel-core-' | xargs -r docker rm -f || true

echo "==> Deploying services: ${SERVICES[*]}"
docker compose --env-file .env up -d --build --remove-orphans "${SERVICES[@]}"
docker compose --env-file .env ps
echo "==> Deploy finished"
