# Member Guide — PATHIRANA D.P.C.N. (230465J)

**Role:** Web Dashboard, Notification Service & Appointment Service  
**Repos:**  
- `web-dashboard` (port `5173`)  
- `omnichannel-backend` → `apps/notification` (`3004`), `apps/appointment` (`3005`)  
**Workload:** ~35%

> **Full project story:** read [FULL_PROJECT_SCENARIOS.md](./FULL_PROJECT_SCENARIOS.md) first (especially Scenarios A, B, F, and the demo script in §12).  
> **Salon registration UI:** [ONBOARDING_NEW_SALON.md](./ONBOARDING_NEW_SALON.md).

---

## 1. What You Own

You own what the **business owner / agent sees and uses**, plus alerts and booking.

| Component | Location | Job |
|-----------|----------|-----|
| Web Dashboard | `web-dashboard` | Agent inbox, lead list, analytics, replies |
| Notification Service | `apps/notification` | Email (primary), SMS stretch |
| Appointment Service | `apps/appointment` | Availability, booking, reminders |

**Course Iteration 1 focus for you:** GUI + connect DB/APIs — frontend should look complete by Progress Review 1 (~14 Aug).

---

## 2. How Your Work Connects

```
Dashboard ──WebSocket──► Gateway (PANKAJA)     live chat / agent reply
Dashboard ──REST──────► Lead Manager (PADMASIRI)  lead list/status
Dashboard ──REST──────► Appointment (you)         bookings
Dashboard ──REST──────► Chatbot (PADMASIRI)       optional config later

Lead / Appointment ──REST──► Notification (you)   email staff
```

You depend on:

- Gateway WebSocket events from **PANKAJA**
- Lead APIs from **PADMASIRI**
- Stable CORS / URLs in `.env`

---

## 3. Environment Setup

```bash
# Dashboard
cd web-dashboard
bun install
cp .env.example .env
# VITE_GATEWAY_URL=http://localhost:3000
bun run dev   # http://localhost:5173

# Notification + Appointment (monorepo)
cd ../omnichannel-backend
bun install
bun run dev:notification
bun run dev:appointment
```

---

## 4. Detailed Task Breakdown — Web Dashboard

### Tech stack (already chosen)

- Vue 3 + Vite + TypeScript  
- Pinia for state  
- Vue Router for pages  
- WebSocket client for realtime  

### Screens to build (priority order)

| Priority | Screen | Purpose | Needed by |
|----------|--------|---------|-----------|
| P0 | Login / simple agent auth (can be stub JWT) | Enter console | Mid eval |
| P0 | Inbox / conversation list | See active chats | Progress Review 1 |
| P0 | Chat view | Read thread + send reply | Progress Review 1 |
| P0 | Lead list | Filter by status / score | Progress Review 1 |
| P1 | Lead detail | Notes, status change, assign | Iteration 2 |
| P1 | Appointments calendar / list | Bookings | Iteration 2 |
| P2 | Analytics cards | Lead counts by status | Before final |
| P2 | Settings stub | business name / chatbot on-off | Nice to have |

### Pinia stores to plan

| Store | Holds |
|-------|--------|
| `auth` | agent id, token |
| `conversations` | messenger list, selected chat, messages |
| `leads` | lead array, filters |
| `appointments` | upcoming bookings |
| `ui` | toasts, connection status |

### WebSocket responsibilities

Connect to gateway (agree URL with PANKAJA), e.g. `ws://localhost:3000/ws/agents`.

Handle at least:

| Event type | UI action |
|------------|-----------|
| `connected` | Show “online” |
| `new_message` | Append to chat + toast |
| `new_lead` / `conversation_queued` | Badge on inbox |
| `error` | Show reconnect hint |

Send:

| Action | Payload idea |
|--------|----------------|
| `register` | `{ type: "register", agent_id, token }` |
| `agent_reply` | `{ type: "agent_reply", messenger_id, platform, message }` |

### Mobile-responsive requirement

Course accepts mobile-friendly web. Test layouts on phone width (~375px):

- Stack chat list above chat pane OR use drawer
- Large tap targets for reply send
- Don’t rely on hover-only actions

### Dashboard checklist

| # | Task | Done when… |
|---|------|------------|
| D1 | Project scaffold (Vue + Pinia + router) | App loads |
| D2 | Layout shell (nav: Inbox, Leads, Appointments) | Navigate works |
| D3 | Inbox UI with mock data | Looks demo-ready |
| D4 | Wire REST to lead-manager | Real leads show |
| D5 | Wire WebSocket to gateway | Live message appears |
| D6 | Send reply from UI | Customer gets Telegram message |
| D7 | Lead status update from UI | PATCH works |
| D8 | Appointments UI | List/create booking |
| D9 | Analytics summary | Counts match API |
| D10 | Empty / loading / error states | No blank crashes |

---

## 5. Detailed Task Breakdown — Notification Service

### Scope for semester

| Channel | Priority |
|---------|----------|
| Email (SMTP / Mailtrap / Gmail app password) | **Must** |
| SMS | Stretch |
| Push | Out of scope unless easy |

### APIs

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/notifications/email` | Send templated email |
| `GET` | `/api/notifications` | Optional history |
| `GET` | `/health` | Health |

### Email templates (minimum)

| Template | Trigger |
|----------|---------|
| `new_lead` | Lead created / assigned |
| `appointment_confirmed` | Booking created |
| `appointment_reminder` | Optional 24h before |

### Checklist

| # | Task | Done when… |
|---|------|------------|
| N1 | SMTP config via env | Mailtrap receives test mail |
| N2 | `POST /email` with template + data | 200 + logged |
| N3 | Persist notification row (optional but good) | `notifications.db` |
| N4 | Called from lead-manager | New lead email in demo |
| N5 | Called from appointment | Booking email in demo |

---

## 6. Detailed Task Breakdown — Appointment Service

### Database (`appointments.db`)

| Table | Purpose |
|-------|---------|
| `appointments` | booking records |
| `availability_slots` | business weekly hours |

### APIs

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/appointments/availability` | Free slots for date |
| `POST` | `/api/appointments` | Create booking |
| `GET` | `/api/appointments` | List |
| `PATCH` | `/api/appointments/:id` | Cancel / complete |
| `POST` | `/chat` | Called by routing for `appointment_booking` intent |
| `GET` | `/health` | Health |

### `/chat` behavior (simple NLP for demo)

For Iteration 2, you do **not** need full NLP:

1. If routing already summarized “Thursday 2pm”, parse that string with simple rules or Gemini later.
2. Check availability.
3. If free → create appointment + confirmation message.
4. If busy → return alternative slots as text.

### Checklist

| # | Task | Done when… |
|---|------|------------|
| A1 | Schema + seed business hours | Availability returns slots |
| A2 | Create / list / cancel APIs | Curl works |
| A3 | Conflict check | Double-book blocked |
| A4 | `/chat` book flow | Returns confirmation messages |
| A5 | Notify staff via notification service | Email sent |
| A6 | Dashboard can create/view appointments | UI wired |
| A7 | Reminder job (stretch) | Cron or on-read reminder flag |

---

## 7. What You Are NOT Responsible For

- Gemini routing logic → **PANKAJA**
- Chatbot flow templates → **PADMASIRI**
- Telegram adapter internals → **PANKAJA** (you only consume WebSocket/API)

---

## 8. Integration Checklist

| With | Agree on | Why |
|------|----------|-----|
| PANKAJA | WebSocket URL, auth, event types | Live inbox |
| PANKAJA | Agent reply message format | Reply reaches customer |
| PADMASIRI | Lead JSON fields (`id`, `status`, `score`, …) | Lead pages |
| PADMASIRI | When notification is triggered | Email demo |
| All | Demo business: Elegant Salon scenario | Same data everywhere |

---

## 9. Suggested Weekly Focus

| Period | Focus |
|--------|--------|
| Start of coding (~13 Jul) → Progress Review 1 (~14 Aug) | **Frontend first**: shell, inbox, leads UI, connect APIs |
| Mid evaluation (~late Aug) | Demo UI looking complete + live or mocked chat |
| Until coding freeze (~5 Sep) | Notifications, appointments, WebSocket polish |
| September | Testing UI flows, demo video recording, presentation |

**Remember team plan:** Frontend finish ~**2nd week of August**; after September focus testing + YouTube demo video.

---

## 10. Definition of Done

1. Agent can open dashboard, see leads, open a conversation.
2. Agent reply from UI reaches Telegram customer (via gateway).
3. New lead can trigger email notification.
4. Appointment can be booked (API + UI or chatbot path).
5. UI works on mobile browser width.
6. Demo video can show your screens clearly.

---

## 11. Demo Script Pieces You Own Visually

Practice saying while screen-sharing:

1. “Here is the agent inbox — new WhatsApp/Telegram lead appeared live.”
2. “Lead score and status are here.”
3. “I reply from the dashboard — customer gets it on Telegram.”
4. “Appointment is booked — email notification sent.”

---

## 12. Useful Files

| File | Why |
|------|-----|
| `web-dashboard/src/App.vue` | Current scaffold |
| `apps/notification/src/index.ts` | Skeleton to extend |
| `apps/appointment/src/index.ts` | Skeleton to extend |
| `docs/ARCHITECTURE.md` | DB + flow |
| `docs/API_DOCUMENTATION.md` | Endpoint contracts |

---

## 13. Your scenes in the full project scenarios

| Scenario | Your job |
|----------|----------|
| **A** Master demo | Live inbox, agent reply UI, email, appointment UI |
| **B** Register salon | Sign-up + Settings (Telegram/WhatsApp paste) |
| **C** After-hours | Owner sees overnight lead + email next morning |
| **D** Escalation | Queue UI / claim chat |
| **F** Appointment | Availability + book + confirmation email |
| **I** Multi-tenant | Login scoped to one `business_id` |
| **Demo video §12** | You drive most of the on-screen walkthrough |

Walkthrough: [FULL_PROJECT_SCENARIOS.md](./FULL_PROJECT_SCENARIOS.md)

---

## 14. Your part of salon onboarding (registration UI)

Read the full flow: **[ONBOARDING_NEW_SALON.md](./ONBOARDING_NEW_SALON.md)**

You own the **screens the salon owner uses** to join and connect channels:

| You build | Notes |
|-----------|--------|
| Register / login (MVP) | Creates `business_id` |
| Settings → business profile | Name, sector (`salon`) |
| Settings → Telegram | Paste BotFather token → call Gateway API |
| Settings → WhatsApp | Paste Meta Phone Number ID + token (even if WA is stretch) |
| Short help text | Steps for BotFather / Meta console |
| Tenant-scoped UI | After login, only that salon’s leads/chats |

**Demo tip:** Keep a pre-seeded Elegant Salon for evaluations, and still show the register/connect UI as the “how a new salon joins” story.

---

## 15. Questions to Ask Mentors / Team Early

- Stub login OK for mid evaluation, or real auth required?
- Mailtrap OK as email proof for final demo?
- Calendar UI detail level expected?
