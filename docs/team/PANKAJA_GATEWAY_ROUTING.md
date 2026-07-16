# Member Guide — PANKAJA D.L.K. (230461T)

**Role:** Messaging Gateway & Routing  
**Repos:** `omnichannel-backend` → `apps/gateway`, `apps/routing`  
**Ports:** Gateway `3000` · Routing `3001`  
**Workload:** ~40%

> **Full project story:** read [FULL_PROJECT_SCENARIOS.md](./FULL_PROJECT_SCENARIOS.md) first (especially Scenarios A, D, E, G, J).  
> **Salon bots:** [ONBOARDING_NEW_SALON.md](./ONBOARDING_NEW_SALON.md).

---

## 1. What You Own

You own the **front door** of the system and the **AI brain** that decides where each message goes.

| Component | Path | Job |
|-----------|------|-----|
| Messaging Gateway | `apps/gateway` | Receive Telegram/WhatsApp/web messages, save them, talk to routing, send replies, WebSocket to agents |
| Routing Service | `apps/routing` | Use Gemini to detect intent + language, forward to chatbot / lead / appointment |

If your parts work, a customer can message Telegram and get *something* back — even before the full chatbot is ready.

---

## 2. How Your Work Connects

```
Customer (Telegram)
    → Gateway (you) saves message
    → Routing (you) classifies with Gemini
    → Chatbot / Lead / Appointment (teammates)
    → Gateway (you) sends reply to customer
    → WebSocket (you) updates Dashboard (PATHIRANA)
```

**API contract you must keep stable:**

```http
POST http://localhost:3001/chat
Content-Type: application/json

{
  "message": "What are your prices?",
  "messenger_id": "12345",
  "platform": "telegram",
  "language": "en",
  "history": [ ... ]
}
```

Downstream services expect:

```json
{
  "success": true,
  "messages": [{ "type": "text", "text": "..." }],
  "escalated": false
}
```

Gateway already calls routing via `ROUTING_AGENT_URL` / `http://localhost:3001/chat`. Do not break this without telling the team.

---

## 3. Environment Setup

```bash
git clone https://github.com/Omnichannel-Lead-Management/omnichannel-backend.git
cd omnichannel-backend
bun install

cp apps/gateway/.env.example apps/gateway/.env
cp apps/routing/.env.example apps/routing/.env
# Put GEMINI_API_KEY in routing .env
# Put TELEGRAM_BOT_TOKEN in gateway .env

bun run dev:gateway   # terminal 1
bun run dev:routing   # terminal 2
```

**You need:**
- [ ] Bun installed
- [ ] Telegram bot from BotFather
- [ ] Gemini API key (Google AI Studio)
- [ ] ngrok (for Telegram webhooks on localhost)

---

## 4. Detailed Task Breakdown

### Phase A — Gateway foundations (already partly done)

**Goal:** Telegram message in → saved in DB → forwarded to routing → reply out.

| # | Task | Done when… | Notes |
|---|------|------------|-------|
| A1 | Confirm gateway starts on `:3000` | `GET /health` works | Code already exists |
| A2 | Telegram webhook route | Bot receives messages via ngrok | `apps/gateway/src/routes/telegram.routes.ts` |
| A3 | Message save to SQLite | Message appears in `messaging.db` | Drizzle schema in `src/db/` |
| A4 | Call routing after save | Logs show `ROUTING_DECISION` | `MessageOrchestrator.ts` |
| A5 | Send reply via Telegram adapter | Customer sees bot reply | Even a placeholder reply is OK early |
| A6 | Document env vars | `.env.example` complete | Tokens, ports, routing URL |

**Acceptance demo:** You send “hi” on Telegram → see it in DB → get a reply (even from routing “general” greeting).

---

### Phase B — Routing + Gemini (already partly done)

| # | Task | Done when… | Notes |
|---|------|------------|-------|
| B1 | Routing listens on `:3001` | `GET /health` returns agent status | Fix default port if needed |
| B2 | Gemini intent classification | Returns agent name + language | `router.ts` |
| B3 | Agent registry correct for lead platform | Routes to `service_inquiry`, `appointment_booking`, `lead_qualification`, `general` | `agents/registry.ts` |
| B4 | Language EN / SI / TA | Correct language in response | Already started |
| B5 | Circuit breaker | Downstream down → fallback message, not crash | `circuitBreaker.ts` |
| B6 | Keyword fallback if Gemini fails | Still routes somehow | Important for demos |

**Acceptance demo:** Message “I want to book tomorrow 2pm” → routing chooses `appointment_booking`. Message “how much for haircut?” → `service_inquiry`.

---

### Phase C — WebSocket & agent channel

| # | Task | Done when… | Notes |
|---|------|------------|-------|
| C1 | Agent WebSocket `/ws/agents` | Dashboard can connect | PATHIRANA depends on this |
| C2 | Broadcast new message / new lead events | Dashboard updates live | Agree event JSON with PATHIRANA |
| C3 | Agent reply path | Dashboard → Gateway → Telegram | Escalation flow |
| C4 | Escalation queue | `escalated: true` from routing → notify agents | Mark messenger escalated |

**Event shape (agree with PATHIRANA):**

```json
{
  "type": "new_message",
  "platform": "telegram",
  "messenger_id": "123",
  "text": "Hello",
  "timestamp": "..."
}
```

---

### Phase D — Hardening & secondary channel

| # | Task | Done when… | Notes |
|---|------|------------|-------|
| D1 | WhatsApp adapter (stretch) | WhatsApp message works OR clearly marked stretch | Telegram is primary for demo |
| D2 | Webhook signature / secret checks | Invalid webhook rejected | Security for final eval |
| D3 | Correlation IDs in logs | Can trace one message across services | Already partially there |
| D4 | Health checks for Docker Compose | Compose reports healthy | Needed for Iteration 2 |
| D5 | Performance | Auto reply path &lt; ~3 seconds | Success criterion |

---

## 5. What You Are NOT Responsible For

- Chatbot flow templates / flow engine → **PADMASIRI**
- Lead scoring algorithm UI → **PADMASIRI** (you only forward to lead-manager)
- Vue dashboard screens → **PATHIRANA**
- Email/SMS content → **PATHIRANA**
- Appointment availability UI → **PATHIRANA**

You **do** need to expose stable HTTP/WebSocket so they can plug in.

---

## 6. Integration Checklist With Teammates

| With | Agree on | When |
|------|----------|------|
| PADMASIRI | Chatbot `/chat` request/response body | Before Iteration 2 |
| PADMASIRI | Lead manager `/chat` or `/api/leads` for auto-create | Before mid eval polish |
| PATHIRANA | WebSocket events + agent reply payload | During Iteration 1 |
| All | `business_id` / messenger_id format | Early design |

---

## 7. Suggested Weekly Focus (aligned to course deadlines)

| Period | Focus |
|--------|--------|
| After Feasibility (from ~13 Jul) | Gateway Telegram end-to-end + routing Gemini |
| Until Progress Review 1 (~14 Aug) | DB + APIs that dashboard can call; WebSocket basics |
| Mid evaluation (~late Aug) | Demo: Telegram → routing → reply |
| Until coding freeze (~5 Sep) | Orchestrator, escalation, WebSocket polish |
| After coding freeze | Testing, ngrok for final demo, security |

---

## 8. Definition of Done (your modules)

You are done when:

1. Telegram customer message is stored and routed via Gemini.
2. Correct downstream service is called based on intent.
3. Reply returns to the customer on Telegram.
4. Agents can connect over WebSocket and send a reply.
5. Escalation to human works when routing/chatbot sets `escalated: true`.
6. `docker compose` can start gateway + routing with env files.

---

## 9. Useful Files

| File | Why |
|------|-----|
| `apps/gateway/src/services/MessageOrchestrator.ts` | Main message pipeline |
| `apps/gateway/src/routes/telegram.routes.ts` | Telegram webhook |
| `apps/gateway/src/routes/agent.websocket.routes.ts` | Agent realtime |
| `apps/routing/src/router.ts` | Gemini classification |
| `apps/routing/src/agents/registry.ts` | Where messages are forwarded |
| `docs/ARCHITECTURE.md` | Full flow diagrams |
| `docs/API_DOCUMENTATION.md` | Endpoint reference |

---

## 10. Your scenes in the full project scenarios

| Scenario | Your job |
|----------|----------|
| **A** Master demo | Webhook, routing, send bot/agent replies to Telegram |
| **B** Register salon | Save tokens, setWebhook, resolve `business_id` |
| **D** Escalation | Mark escalated, notify agents, skip bot while claimed |
| **E** Chatbot off | Skip chatbot; still save message / queue human |
| **G** Sinhala/Tamil | Language detect + pass tag downstream |
| **H** WhatsApp | Stretch adapter |
| **J** Failures | Circuit breaker, Gemini fallback |

Walkthrough: [FULL_PROJECT_SCENARIOS.md](./FULL_PROJECT_SCENARIOS.md)

---

## 11. Your part of salon onboarding (Telegram / WhatsApp)

Read the full flow: **[ONBOARDING_NEW_SALON.md](./ONBOARDING_NEW_SALON.md)**

You own the **channel connection** after the owner pastes credentials:

| You build | Notes |
|-----------|--------|
| `businesses` table (tokens per salon) | Upgrade from single `.env` bot |
| API to save Telegram token | Called from PATHIRANA’s Settings UI |
| `setWebhook` for that bot | ngrok in dev; real URL in demo |
| Resolve `business_id` on webhook | So messages belong to the right salon |
| WhatsApp adapter + webhook verify | Stretch; Telegram is primary |

**Skeleton today:** one `TELEGRAM_BOT_TOKEN` in `.env` (fine for demo).  
**Next:** per-business tokens as in the onboarding doc.

---

## 11. Questions to Ask Mentor Early

- Is Telegram-only enough for final demo?
- Is Gemini free-tier OK to show in evaluation?
- Any required logging / audit format?
