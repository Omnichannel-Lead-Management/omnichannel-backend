#!/usr/bin/env bash
# register-telegram-webhook.sh
#
# Registers the Telegram webhook with the Bot API.
# Usage:  ./register-telegram-webhook.sh <PUBLIC_BASE_URL>
# Example: ./register-telegram-webhook.sh https://your-domain.example.com
#
# Reads TELEGRAM_BOT_TOKEN and TELEGRAM_SECRET from a .env file in the same
# directory (if present), or from the current environment.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load .env if it exists
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -o allexport
  # shellcheck disable=SC1091
  source "$SCRIPT_DIR/.env"
  set +o allexport
fi

PUBLIC_BASE_URL="${1:-${ORCHESTRATOR_PUBLIC_URL:-}}"

if [[ -z "$PUBLIC_BASE_URL" ]]; then
  echo "Error: PUBLIC_BASE_URL is required." >&2
  echo "Usage: $0 <PUBLIC_BASE_URL>" >&2
  echo "  or set ORCHESTRATOR_PUBLIC_URL in .env" >&2
  exit 1
fi

# Strip trailing slash
PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"

if [[ -z "${TELEGRAM_BOT_TOKEN:-}" ]]; then
  echo "Error: TELEGRAM_BOT_TOKEN is not set." >&2
  exit 1
fi

if [[ -z "${TELEGRAM_SECRET:-}" ]]; then
  echo "Error: TELEGRAM_SECRET is not set." >&2
  exit 1
fi

WEBHOOK_URL="${PUBLIC_BASE_URL}/webhook/telegram"

echo "Registering Telegram webhook..."
echo "  URL: $WEBHOOK_URL"

RESPONSE=$(curl -s -X POST \
  "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"${WEBHOOK_URL}\",
    \"secret_token\": \"${TELEGRAM_SECRET}\",
    \"allowed_updates\": [\"message\", \"edited_message\", \"callback_query\"]
  }")

echo "Response: $RESPONSE"

if echo "$RESPONSE" | grep -q '"ok":true'; then
  echo "Webhook registered successfully."
else
  echo "Error: Webhook registration failed." >&2
  exit 1
fi
