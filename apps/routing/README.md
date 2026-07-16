# Routing Service
**Port:** 3001

AI-powered intent classification and routing service.

## Overview
Analyzes incoming messages using Google Gemini AI to detect intent and route to appropriate service.

## Documentation
See [Platform Docs](../../docs/) for complete setup.

## Quick Start
```bash
bun install
cp .env.example .env
bun run dev
```

## Structure
- `src/services/` - AI classification logic
- `src/controllers/` - Routing endpoints
