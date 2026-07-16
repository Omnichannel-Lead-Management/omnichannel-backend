# Repository Setup Guide
## 3-Repository Structure

---

## Repositories

### 1. `omnichannel-backend` (monorepo)

Core backend services and platform documentation.

```
omnichannel-backend/
├── apps/
│   ├── gateway/          # Port 3000 — PANKAJA
│   ├── routing/          # Port 3001 — PANKAJA
│   ├── lead-manager/     # Port 3002 — PADMASIRI
│   ├── notification/     # Port 3004 — PATHIRANA
│   └── appointment/      # Port 3005 — PATHIRANA
├── packages/
│   └── shared/
├── docs/
└── deployment/
    └── docker-compose.yml
```

### 2. `chatbot-builder` (separate) — PADMASIRI

Optional chatbot flow engine (port 3003). Core platform works without it.

### 3. `web-dashboard` (separate) — PATHIRANA

Vue 3 frontend (port 5173).

---

## Clone All

```bash
git clone https://github.com/Omnichannel-Lead-Management/omnichannel-backend.git
git clone https://github.com/Omnichannel-Lead-Management/chatbot-builder.git
git clone https://github.com/Omnichannel-Lead-Management/web-dashboard.git
```

---

## Team Ownership

| Member | Primary repos / folders |
|--------|-------------------------|
| PANKAJA (230461T) | `apps/gateway`, `apps/routing` |
| PADMASIRI (230453V) | `apps/lead-manager`, `chatbot-builder` |
| PATHIRANA (230465J) | `web-dashboard`, `apps/notification`, `apps/appointment` |

---

## Deprecated repos

These old per-service repos are archived and should not be used:

- messaging-gateway, routing-service, lead-manager, notification-service, appointment-service, platform-docs
