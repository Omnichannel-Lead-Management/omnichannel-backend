# Telegram Bot Setup Guide

Complete guide to set up your Telegram bot with the Messaging Orchestrator.

## Step 1: Create Telegram Bot

1. Open Telegram and search for [@BotFather](https://t.me/botfather)
2. Start a chat and send `/newbot`
3. Follow the instructions:
   - Choose a name (e.g., "Support Bot")
   - Choose a username (must end with 'bot', e.g., "support_bot")
4. Copy the bot token provided (format: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`)

## Step 2: Configure Environment

Add your bot token to `.env`:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
```

## Step 3: Set Webhook URL

### Development (using ngrok)

1. Install ngrok: https://ngrok.com/download

2. Start your local server:
```bash
bun run dev
```

3. Start ngrok tunnel:
```bash
ngrok http 3000
```

4. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

5. Set webhook:
```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://abc123.ngrok.io/webhook/telegram"}'
```

### Production

Replace ngrok URL with your production domain:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://your-domain.com/webhook/telegram"}'
```

## Step 4: Verify Webhook

Check webhook status:

```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo"
```

Expected response:
```json
{
  "ok": true,
  "result": {
    "url": "https://your-domain.com/webhook/telegram",
    "has_custom_certificate": false,
    "pending_update_count": 0
  }
}
```

## Step 5: Test Your Bot

1. Open Telegram
2. Search for your bot username
3. Send `/start` or any message
4. Bot should respond via your external AI system

## Optional: Bot Commands

Set bot commands for better UX:

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/setMyCommands" \
  -H "Content-Type: application/json" \
  -d '{
    "commands": [
      {"command": "start", "description": "Start conversation"},
      {"command": "help", "description": "Get help"},
      {"command": "menu", "description": "Show menu"},
      {"command": "order", "description": "Place an order"}
    ]
  }'
```

## Troubleshooting

### Bot not responding?

1. Check if webhook is set correctly:
```bash
curl "https://api.telegram.org/bot<YOUR_TOKEN>/getWebhookInfo"
```

2. Check server logs:
```bash
docker logs messaging-orchestrator
```

3. Test webhook endpoint directly:
```bash
curl http://localhost:3000/webhook/telegram
```

### Delete webhook (for testing):

```bash
curl -X POST "https://api.telegram.org/bot<YOUR_TOKEN>/deleteWebhook"
```

Then you can use polling instead of webhooks for local testing.

## Advanced: Inline Keyboards

Your external AI can send inline keyboards by including them in the reply metadata:

```json
{
  "platform": "telegram",
  "messenger_id": "tg_123456789",
  "reply_text": "Choose an option:",
  "metadata": {
    "inline_keyboard": [
      [
        {"text": "Option 1", "callback_data": "opt1"},
        {"text": "Option 2", "callback_data": "opt2"}
      ],
      [
        {"text": "Cancel", "callback_data": "cancel"}
      ]
    ]
  }
}
```

## Security

- Never commit your bot token
- Use environment variables
- Rotate token if compromised (via @BotFather)
- Use HTTPS for webhooks (required by Telegram)

## Resources

- [Telegram Bot API Documentation](https://core.telegram.org/bots/api)
- [BotFather Commands](https://core.telegram.org/bots#6-botfather)
- [Webhook Guide](https://core.telegram.org/bots/webhooks)
