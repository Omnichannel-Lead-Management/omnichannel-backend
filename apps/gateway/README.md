# Messaging Gateway
**Port:** 3000

Multi-channel message orchestrator for Omnichannel Lead Management Platform.

## Overview
Central hub for all customer messages across WhatsApp, Telegram, Instagram, Discord, and Web Chat.

## Documentation
See [Platform Docs](../../docs/) for complete setup.

## Quick Start
```bash
bun install
cp .env.example .env
bun run dev
```

## Structure
- `src/controllers/` - Webhook handlers
- `src/services/` - Platform adapters
- `src/models/` - Database schemas
- `src/routes/` - API routes
