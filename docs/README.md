# Omnichannel Lead Management Platform
## Backend Documentation

**Organization:** [Omnichannel-Lead-Management](https://github.com/orgs/Omnichannel-Lead-Management)

Central documentation for the Omnichannel Lead Management Platform — a modular lead management system for small businesses.

---

## Architecture

**3 repositories:**

| Repository | Role |
|------------|------|
| [omnichannel-backend](https://github.com/Omnichannel-Lead-Management/omnichannel-backend) | Backend monorepo (gateway, routing, lead-manager, notification, appointment) + docs |
| [chatbot-builder](https://github.com/Omnichannel-Lead-Management/chatbot-builder) | Optional chatbot flow engine (port 3003) |
| [web-dashboard](https://github.com/Omnichannel-Lead-Management/web-dashboard) | Vue 3 agent console (port 5173) |

```
Customer Channels (WhatsApp, Telegram, Web)
    ↓
[Messaging Gateway] → [Routing Service] → [Chatbot Builder] (optional)
                                       → [Lead Manager]
                                       → [Appointment Service]
    ↓
[Notification Service] → Email/SMS
    ↓
[Web Dashboard] → Agent Console
```

---

## Backend apps (this monorepo)

| Service | Path | Port | Owner |
|---------|------|------|-------|
| Messaging Gateway | `apps/gateway` | 3000 | PANKAJA |
| Routing Service | `apps/routing` | 3001 | PANKAJA |
| Lead Manager | `apps/lead-manager` | 3002 | PADMASIRI |
| Notification Service | `apps/notification` | 3004 | PATHIRANA |
| Appointment Service | `apps/appointment` | 3005 | PATHIRANA |

---

## Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — System architecture and data flows
- **[API_DOCUMENTATION.md](API_DOCUMENTATION.md)** — API reference
- **[SETUP_GUIDE.md](SETUP_GUIDE.md)** — Setup instructions
- **[TEAM_GUIDE.md](TEAM_GUIDE.md)** — Collaboration guidelines
- **[PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)** — Quick reference
- **[docs/REPOSITORY_SETUP.md](docs/REPOSITORY_SETUP.md)** — 3-repo layout

---

## Quick Start

```bash
git clone https://github.com/Omnichannel-Lead-Management/omnichannel-backend.git
cd omnichannel-backend
bun install

# Run individual services
bun run dev:gateway
bun run dev:routing

# Or Docker Compose
cd deployment && docker compose up -d
```

Also clone siblings:

```bash
git clone https://github.com/Omnichannel-Lead-Management/chatbot-builder.git
git clone https://github.com/Omnichannel-Lead-Management/web-dashboard.git
```

---

## Team Ownership

| Member | Index | Primary work |
|--------|-------|--------------|
| PANKAJA D.L.K. | 230461T | Gateway, Routing |
| PADMASIRI G.R.H.D. | 230453V | Lead Manager, Chatbot Builder |
| PATHIRANA D.P.C.N. | 230465J | Web Dashboard, Notification, Appointment |

---

*CS3202 / CS3203 Software Engineering Project — PID-1*
