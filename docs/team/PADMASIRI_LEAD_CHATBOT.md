# Member Guide — PADMASIRI G.R.H.D. (230453V)

**Role:** Lead Manager & Chatbot Builder  
**Repos:**  
- `omnichannel-backend` → `apps/lead-manager` (port `3002`)  
- `chatbot-builder` (separate repo, port `3003`)  
**Workload:** ~35%

> **Full project story:** read [FULL_PROJECT_SCENARIOS.md](./FULL_PROJECT_SCENARIOS.md) first (especially Scenarios A, C, D, E, F).  
> **Salon bots / templates:** [ONBOARDING_NEW_SALON.md](./ONBOARDING_NEW_SALON.md).

---

## 1. What You Own

You own **lead tracking** and the **optional auto-reply chatbot**.

| Component | Location | Job |
|-----------|----------|-----|
| Lead Manager | `apps/lead-manager` | Create/update leads, score, status lifecycle, assignment |
| Chatbot Builder | `chatbot-builder` repo | Flow engine + sector templates (salon, tutor, photography) |

**Critical product rule:** Chatbot is optional. If chatbot is off or down, leads + manual agent replies must still work.

---

## 2. LangChain vs LangGraph — What Should We Use?

### Short answer for this project

| Option | Use it? | Why |
|--------|---------|-----|
| **Custom JSON flow engine (state machine)** | **Yes — recommended primary plan** | Matches proposal: predictable replies, fixed prices, no invented answers |
| **LangGraph** | Optional stretch only | Good for stateful multi-step AI graphs; heavier than you need for templates |
| **LangChain alone** | Not the best fit | Great for LLM tools/RAG; weak as a conversation flow product for SMEs |

### Why not full LangChain / free-chat Gemini for replies?

Your proposal and mentor script already say:

> Chatbot uses **fixed flows**, not free chat AI. Gemini is for **routing/intent**, not inventing salon prices.

If the bot freely generates text, it might invent “Premium package Rs. 9999” — bad for a real business demo.

### Recommended architecture for chatbot

```
Routing (Gemini) decides: service_inquiry
        ↓
Chatbot Builder loads flow JSON for business/sector
        ↓
State machine walks nodes: message → question → branch → action
        ↓
Returns { messages, createLead, leadScore, escalateToHuman }
```

**Optional later (stretch):** use **LangGraph** only to choose the next flow node when the customer message is messy — still reply from templates, not free text.

### If mentor insists on “more AI in chatbot”

Prefer **LangGraph** over LangChain:

- LangGraph = graph of steps + memory (closer to a flow engine)
- LangChain = building blocks (prompts, tools) — you’d still rebuild flow logic yourself

**Decision for team docs:**  
**Primary = custom flow engine. LangGraph = stretch. LangChain = not required.**

---

## 3. How Your Work Connects

```
Routing (PANKAJA)
   ├─ service_inquiry     → POST chatbot:3003/chat   (you)
   └─ lead_qualification  → POST lead-manager:3002/chat or /api/leads  (you)

Chatbot may call Lead Manager to create/update lead
Lead Manager may call Notification (PATHIRANA) on new lead
Dashboard (PATHIRANA) reads leads via REST
```

**Chatbot response contract (keep this):**

```json
{
  "success": true,
  "messages": [
    { "type": "text", "text": "We offer 3 packages: Basic, Standard, Premium." }
  ],
  "escalated": false,
  "createLead": true,
  "leadScore": 30
}
```

---

## 4. Environment Setup

```bash
# Lead manager (monorepo)
cd omnichannel-backend
bun install
cp apps/lead-manager/.env.example apps/lead-manager/.env
bun run dev:lead-manager

# Chatbot (separate repo)
cd ../chatbot-builder
bun install
cp .env.example .env
bun run dev
```

Health checks:

- `GET http://localhost:3002/health`
- `GET http://localhost:3003/health`

---

## 5. Detailed Task Breakdown — Lead Manager

### Database (`leads.db`)

Design tables (see `docs/ARCHITECTURE.md` for full schema):

| Table | Purpose |
|-------|---------|
| `leads` | id, business_id, messenger_id, platform, status, score, source, assigned_agent_id, tags, notes, timestamps |
| `lead_activities` | audit trail of status changes / notes |

**Statuses:** `new` → `contacted` → `qualified` → `converted` (or `lost`)

### Scoring (rule-based first)

| Signal | Example points |
|--------|----------------|
| Created from chatbot | +30 |
| WhatsApp / Telegram source | +10 |
| Asked about premium / booking | +15–20 |
| Appointment booked | +20 |
| Escalated / complaint | flag + notify |

Keep scoring **explainable** for the report (table of rules). Optional Gemini “urgency tag” later as stretch.

### APIs to implement

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/leads` | Create lead |
| `GET` | `/api/leads?businessId=` | List / filter |
| `GET` | `/api/leads/:id` | Detail |
| `PATCH` | `/api/leads/:id` | Update status / score / assignment |
| `POST` | `/chat` | Called by routing for lead_qualification intent |
| `GET` | `/health` | Health |

### Lead Manager tasks checklist

| # | Task | Done when… |
|---|------|------------|
| L1 | SQLite + Drizzle schema | Tables created on startup |
| L2 | CRUD APIs | Postman/curl works |
| L3 | Scoring function | Score updates on create/update |
| L4 | Status lifecycle validation | Invalid transitions rejected or documented |
| L5 | Activity log | Status changes recorded |
| L6 | Assign agent (simple round-robin or first free) | `assigned_agent_id` set |
| L7 | Notify on new lead | Calls notification service OR documents TODO if PATHIRANA not ready |
| L8 | Multi-tenant filter | Always filter by `business_id` |

---

## 6. Detailed Task Breakdown — Chatbot Builder

### Flow JSON model (core of your module)

Each flow is a graph of nodes stored as JSON in `chatbot.db`:

```json
{
  "id": "salon_pricing",
  "business_id": "biz_001",
  "sector": "salon",
  "trigger_intents": ["service_inquiry", "pricing"],
  "nodes": [
    {
      "id": "n1",
      "type": "message",
      "content": "We offer Basic, Standard, and Premium packages.",
      "next": "n2"
    },
    {
      "id": "n2",
      "type": "question",
      "content": "Which package interests you?",
      "wait_for_response": true,
      "next": "n3"
    },
    {
      "id": "n3",
      "type": "branch",
      "conditions": [
        { "keyword": "premium", "next": "n4" },
        { "keyword": "basic", "next": "n5" },
        { "default": true, "next": "n6" }
      ]
    },
    {
      "id": "n4",
      "type": "message",
      "content": "Premium includes haircut + styling + treatment.",
      "action": "update_lead_score",
      "action_params": { "score_increment": 20 },
      "next": "n7"
    },
    {
      "id": "n7",
      "type": "trigger_service",
      "service": "appointment",
      "message": "Would you like to book an appointment?"
    }
  ]
}
```

### Node types to support (minimum)

| Type | Behavior |
|------|----------|
| `message` | Send text, go to `next` |
| `question` | Send text, wait for user reply (session state) |
| `branch` | Match keywords / default path |
| `action` | Update lead score / create lead / set tags |
| `escalate` | Set `escalated: true`, hand to human |
| `trigger_service` | Hint appointment / notification (HTTP call if ready) |

### Session state

Table `chatbot_sessions`: current node, messenger_id, business_id, variables JSON, completed flag.

Without sessions, multi-turn “which package?” won’t work.

### Sector templates (demo content)

| Sector | Flows to ship |
|--------|----------------|
| Salon | Pricing, hours, book appointment handoff |
| Tutor | Course fees, schedule inquiry |
| Photography | Package types, event booking interest |

### Chatbot tasks checklist

| # | Task | Done when… |
|---|------|------------|
| C1 | `chatbot.db` schema (flows + sessions) | DB boots |
| C2 | `POST /chat` executes active flow | Returns messages array |
| C3 | Session resume on next message | Multi-turn works |
| C4 | Keyword branch | “premium” vs “basic” paths |
| C5 | Create lead action | Calls lead-manager |
| C6 | Escalate action | Returns `escalated: true` |
| C7 | Salon template | Demo scenario works |
| C8 | Tutor + photography templates | Extra demos |
| C9 | Disable chatbot flag | If disabled, return escalate / empty so gateway uses human path |
| C10 | (Stretch) LangGraph assist for messy replies | Only if time; still template replies |

---

## 7. What You Are NOT Responsible For

- Telegram webhooks / Gemini routing → **PANKAJA**
- Vue screens → **PATHIRANA** (you expose APIs they call)
- SMTP email → **PATHIRANA** (you trigger via HTTP)

---

## 8. Integration Checklist

| With | Agree on |
|------|----------|
| PANKAJA | Exact `/chat` body from routing; env `CHATBOT_ENGINE_URL` |
| PANKAJA | What happens when chatbot returns `escalated: true` |
| PATHIRANA | Lead list JSON shape for dashboard |
| PATHIRANA | When to fire `POST /api/notifications/email` |

---

## 9. Suggested Weekly Focus

| Period | Focus |
|--------|--------|
| Iteration 1 (to ~14 Aug) | Lead DB + CRUD; chatbot skeleton + one hard-coded flow |
| Mid evaluation | Show lead created + simple auto reply path |
| Iteration 2 (to ~5 Sep) | Full flow engine, sessions, 3 sector templates, scoring |
| After coding freeze | Testing document scenarios for chatbot + leads |

---

## 10. Definition of Done

1. Customer price question → chatbot template reply (not random AI text).
2. Lead auto-created with score and status `new`.
3. Multi-turn flow works with session state.
4. “I want a human” / escalate node → agent path.
5. Chatbot can be disabled without breaking lead manager.
6. Dashboard can list/update leads via your API.

---

## 11. Useful References

- `docs/ARCHITECTURE.md` — chatbot.db / leads.db schemas, flow JSON example  
- `apps/routing/src/agents/registry.ts` — how routing calls you  
- Proposal scope: **no advanced generative chatbot** as core requirement  

---

## 12. Your scenes in the full project scenarios

| Scenario | Your job |
|----------|----------|
| **A** Master demo | Salon pricing flow, create/score lead, status updates |
| **B** Register salon | Auto-attach salon chatbot templates |
| **C** After-hours | Bot answers hours/pricing without agent |
| **D** Escalation | Escalation node / lead_qualification path |
| **E** Chatbot off | Honor `chatbot_enabled`; leads still work |
| **F** Appointment-first | May bump lead when booking succeeds |
| **G** Multilingual | SI/TA template strings (stretch) |

Walkthrough: [FULL_PROJECT_SCENARIOS.md](./FULL_PROJECT_SCENARIOS.md)

---

## 13. Your part of salon onboarding

Read the full flow: **[ONBOARDING_NEW_SALON.md](./ONBOARDING_NEW_SALON.md)**

When a new salon registers with sector `salon`:

| You build | Notes |
|-----------|--------|
| Auto-attach default salon chatbot flows | Pricing / hours / book handoff |
| Scope all flows & leads by `business_id` | Tenant isolation |
| Honor `chatbot_enabled` per business | Core still works if bot off |

You do **not** create the Telegram/WhatsApp bot — the owner does that; PANKAJA connects the webhook; you provide the conversation content.

---

## 14. Mentor One-Liner

> We use Gemini only for routing. The chatbot is a configurable flow engine so small businesses get predictable answers; LangGraph is optional stretch, not required for the base system.
