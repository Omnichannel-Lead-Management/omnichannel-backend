# Omnichannel Backend

Backend monorepo for the Omnichannel Lead Management Platform.

## Structure

```
omnichannel-backend/
├── apps/
│   ├── gateway/          # Messaging Gateway (port 3000) — PANKAJA
│   ├── routing/          # AI Routing Service (port 3001) — PANKAJA
│   ├── lead-manager/     # Lead CRUD & scoring (port 3002) — PADMASIRI
│   ├── notification/     # Email/SMS alerts (port 3004) — PATHIRANA
│   └── appointment/      # Scheduling (port 3005) — PATHIRANA
├── packages/
│   └── shared/           # Shared types & constants
├── docs/                 # Platform documentation
└── deployment/           # Docker Compose configs
```

## Related Repositories

| Repository | Port | Description |
|------------|------|-------------|
| [chatbot-builder](https://github.com/Omnichannel-Lead-Management/chatbot-builder) | 3003 | Optional chatbot flow engine — PADMASIRI |
| [web-dashboard](https://github.com/Omnichannel-Lead-Management/web-dashboard) | 5173 | Vue 3 agent console — PATHIRANA |

## Quick Start

```bash
bun install

bun run dev:gateway
bun run dev:routing
# or: cd apps/gateway && bun run dev
```

## Documentation

See [docs/README.md](./docs/README.md) for architecture, API reference, and setup guides.
