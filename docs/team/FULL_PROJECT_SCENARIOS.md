# Full Project Scenarios — Omnichannel Lead Management Platform

**Project:** PID-1 · CS3202/CS3203  
**Product:** Omnichannel Lead Management Platform with Configurable Chatbot  
**Team:** PANKAJA (Gateway/Routing) · PADMASIRI (Lead/Chatbot) · PATHIRANA (Dashboard/Notify/Appt)

This document is the **single storybook** of how the whole system works — from a new salon joining, through customer chats, leads, agents, appointments, and demo day. Use it with the member guides.

| Related guide | Path |
|---------------|------|
| Onboarding (bots) | [ONBOARDING_NEW_SALON.md](./ONBOARDING_NEW_SALON.md) |
| PANKAJA | [PANKAJA_GATEWAY_ROUTING.md](./PANKAJA_GATEWAY_ROUTING.md) |
| PADMASIRI | [PADMASIRI_LEAD_CHATBOT.md](./PADMASIRI_LEAD_CHATBOT.md) |
| PATHIRANA | [PATHIRANA_DASHBOARD.md](./PATHIRANA_DASHBOARD.md) |

---

## 0. Actors & demo world

### People

| Actor | Who | Goal |
|-------|-----|------|
| **Salon owner** | Nimali (Elegant Salon) | Register, connect bots, see leads & reports |
| **Agent / staff** | Sithumi | Reply to customers from dashboard |
| **Customer** | Kasun | Ask prices, book haircut on Telegram (or WhatsApp) |
| **System admin** | Team (dev only) | Seed data, ngrok, health checks |

### Demo business (always seed this)

| Field | Value |
|-------|--------|
| `business_id` | `biz_001` |
| Name | Elegant Salon |
| Sector | `salon` |
| Channels | Telegram bot `@ElegantSalonSupportBot` (primary); WhatsApp optional |
| Chatbot | Enabled — salon pricing + booking handoff flows |
| Hours | 09:00–18:00 |

### Repos & ports (reminder)

```
Customer → Gateway :3000 (PANKAJA)
              → Routing :3001 (PANKAJA) → Gemini
              → Chatbot :3003 (PADMASIRI)
              → Lead Manager :3002 (PADMASIRI)
              → Appointment :3005 (PATHIRANA)
              → Notification :3004 (PATHIRANA)
Agent ←→ Dashboard :5173 (PATHIRANA) ←WebSocket→ Gateway
```

---

## 1. Master scenario (the one for final demo)

**Story in one sentence:**  
Kasun messages Elegant Salon on Telegram at night about haircut prices → chatbot replies → lead is created → next morning Sithumi sees the lead, replies → Kasun books Thursday 2pm → owner gets email.

### Timeline of the story

| When | What happens |
|------|----------------|
| Day 0 | Nimali registers salon, connects Telegram bot |
| Day 0 night 21:10 | Kasun asks prices |
| Day 0 night 21:10 | Bot replies + lead created + optional email |
| Day 1 morning 09:05 | Sithumi opens dashboard, sees lead |
| Day 1 morning 09:08 | Sithumi replies as human |
| Day 1 morning 09:15 | Kasun asks to book Thursday 2pm |
| Day 1 morning 09:16 | Appointment confirmed + email |

### Step-by-step (full system)

```
┌─────────────────────────────────────────────────────────────────┐
│ SCENARIO A — FULL DEMO (Telegram + Chatbot + Lead + Agent + Appt) │
└─────────────────────────────────────────────────────────────────┘

A0. ONBOARDING (already done before demo — see Scenario B)
    Elegant Salon exists as biz_001
    Telegram webhook points to Gateway
    Salon chatbot flow active

A1. CUSTOMER → TELEGRAM
    Kasun opens @ElegantSalonSupportBot
    Sends: "Hi, what are your haircut prices?"

A2. TELEGRAM → GATEWAY (PANKAJA)
    POST /webhook/telegram
    Resolve business_id = biz_001
    Upsert messenger (Kasun)
    Save chat_messages (is_from_user=true)
    Load recent history

A3. GATEWAY → ROUTING (PANKAJA)
    POST /chat
    Gemini classifies:
      intent/agent ≈ service_inquiry
      language ≈ english (or sinhala if typed in Sinhala)
    Summary: "Customer asking about haircut prices"

A4. ROUTING → CHATBOT (PADMASIRI)
    POST http://chatbot:3003/chat
    Load salon pricing flow for biz_001
    Session starts / continues
    Nodes run:
      - message: packages Basic / Standard / Premium
      - question: which package?
    Return messages[]
    Flags: createLead=true, leadScore=30

A5. GATEWAY sends bot replies to Telegram (PANKAJA)
    Kasun sees package list on Telegram
    Replies saved (is_from_user=false)

A6. LEAD CREATED (PADMASIRI)
    POST /api/leads
    {
      business_id: biz_001,
      messenger_id: <kasun>,
      platform: telegram,
      status: new,
      score: 40,          // 30 + telegram bonus
      source: chatbot,
      service_interest: haircut
    }
    Activity log: lead_created

A7. NOTIFICATION (PATHIRANA)
    Lead Manager → POST /api/notifications/email
    To: owner@elegantsalon.lk
    Template: new_lead
    Subject: New Telegram lead — haircut inquiry

A8. DASHBOARD LIVE UPDATE (PATHIRANA ← PANKAJA)
    Gateway WebSocket → agents
    Event: new_lead / new_message
    Sithumi’s inbox shows Kasun without refresh

A9. AGENT REPLY (PATHIRANA UI → PANKAJA Gateway → Telegram)
    Sithumi types: "Hi Kasun! Premium is Rs. X. Want Thursday afternoon?"
    WS agent_reply → Gateway
    Gateway sends via Telegram adapter
    Lead status → contacted (PADMASIRI)

A10. BOOKING (customer)
    Kasun: "Thursday 2pm works"
    Routing → appointment_booking (PANKAJA)
    Appointment service (PATHIRANA):
      parse time → check availability → create appointment
    Reply: "Booked Thursday 14:00 — see you!"
    Lead score +20, status → qualified (PADMASIRI)
    Email confirmation (PATHIRANA)

A11. DONE
    Demo shows: Telegram thread + Lead card + Appointment + Email proof (Mailtrap)
```

### Who is “on stage” for each beat

| Beat | Primary owner | Supporting |
|------|---------------|------------|
| A2–A3, A5, A9 send | PANKAJA | — |
| A4, A6, A9 status | PADMASIRI | — |
| A7, A8 UI, A10 book | PATHIRANA | PANKAJA WS |

---

## 2. Scenario B — New salon registers & connects bots

Full detail also in [ONBOARDING_NEW_SALON.md](./ONBOARDING_NEW_SALON.md).

```
B1. Nimali opens Dashboard → Register
    PATHIRANA: form (name, sector=salon, email, password)
    System creates business_id=biz_00X

B2. PADMASIRI: auto-clone salon chatbot templates for biz_00X

B3. Nimali → Settings → Telegram
    She creates bot via BotFather (manual)
    Pastes token into UI (PATHIRANA)
    Gateway saves token + setWebhook (PANKAJA)

B4. Optional: Settings → WhatsApp
    Paste Meta Phone Number ID + token (PATHIRANA UI)
    Gateway stores + webhook verify (PANKAJA)
    Stretch if Meta is slow

B5. Nimali enables chatbot toggle
    PADMASIRI: chatbot_enabled=1 for business

B6. Smoke test
    Team messages the new bot → sees reply + lead in that salon’s inbox only
```

**Semester note:** For evaluations, use pre-seeded `biz_001`. Still show registration UI as “how real salons join.”

---

## 3. Scenario C — After-hours chatbot only (no agent online)

```
C1. 21:30 — Kasun: "Are you open tomorrow?"
C2. Gateway → Routing → service_inquiry / general
C3. Chatbot flow: business hours node → "We are open 9am–6pm"
C4. Lead created (low/medium score) OR activity on existing lead
C5. No agents connected on WebSocket
C6. Email still sent to owner (PATHIRANA)
C7. Morning — Sithumi sees overnight lead and follows up
```

**Proves:** 24×7 value without a human online.

---

## 4. Scenario D — Customer wants a human (escalation)

```
D1. Kasun: "This bot is useless, I want to talk to someone"
D2. Routing → lead_qualification OR chatbot escalate node
D3. Response includes escalated=true
D4. Gateway marks messenger is_escalated=1, status=queued
D5. WebSocket notifies agents (PANKAJA → PATHIRANA UI)
D6. If no agent online: customer gets "please wait" message
D7. Sithumi claims chat → replies manually
D8. Further messages skip chatbot while escalated (PANKAJA orchestrator)
```

**Proves:** Chatbot is optional; human path works.

---

## 5. Scenario E — Chatbot disabled

```
E1. Owner turns chatbot OFF in Settings (PATHIRANA → flag on business)
E2. Kasun messages about prices
E3. Routing may still classify intent, but chatbot returns disabled / Gateway skips bot
E4. Lead still created (PADMASIRI) OR message queued for agent
E5. Agent replies from dashboard only
```

**Proves:** Core lead management survives without automation (mentor talking point).

---

## 6. Scenario F — Appointment-first message

```
F1. Kasun: "I want to book a haircut Thursday at 2pm"
F2. Routing → appointment_booking (PANKAJA / Gemini)
F3. Appointment /chat (PATHIRANA):
      extract date/time (simple rules OK for demo)
      check availability_slots
      if free → create appointment
      if busy → suggest next slots as text
F4. Confirmation messages to Telegram via Gateway
F5. Lead linked + score bump (PADMASIRI)
F6. Email to salon (PATHIRANA)
```

---

## 7. Scenario G — Multilingual (Sinhala / Tamil)

```
G1. Kasun writes in Sinhala: "මිල කීයද?" (what is the price?)
G2. Routing detects language_tag=sinhala (PANKAJA)
G3. Chatbot returns Sinhala template messages if flow has si content
    OR English template + language note (MVP acceptable)
G4. Greeting / fallback strings already exist in routing for si/ta
```

**MVP:** Detection + EN templates OK. **Better:** SI/TA strings in salon flow (PADMASIRI).

---

## 8. Scenario H — WhatsApp path (stretch)

Same as Scenario A, but:

```
H1. Customer uses WhatsApp
H2. Meta → Gateway /webhook/whatsapp (PANKAJA)
H3. Rest identical (routing → chatbot → lead → dashboard)
```

Only required if Meta test number is ready. Do **not** block final demo on this.

---

## 9. Scenario I — Multi-tenant isolation

```
I1. Two businesses: Elegant Salon (biz_001), Bright Tutors (biz_002)
I2. Message to Salon bot must NEVER appear in Tutors dashboard
I3. Every query filters business_id
I4. Agent JWT contains business_id (PATHIRANA auth)
```

**Demo trick:** Show two browser profiles / two logins if time; otherwise explain with DB screenshot.

---

## 10. Scenario J — Failure & resilience

| Failure | Expected behavior | Owner |
|---------|-------------------|--------|
| Gemini down | Keyword fallback routing | PANKAJA |
| Chatbot down | Escalate / queue for human; create lead anyway | PANKAJA + PADMASIRI |
| Notification SMTP fail | Log error; don’t block lead create | PATHIRANA |
| Agent WebSocket disconnect | UI shows offline; reconnect | PATHIRANA + PANKAJA |
| Double-book appointment | API rejects conflict | PATHIRANA |

---

## 11. Data flowing through one customer journey

```
messengers          Kasun on telegram for biz_001
chat_messages       all texts both directions
chatbot_sessions    current node in pricing flow
leads               score, status new→contacted→qualified
lead_activities     created, status_changed, note_added
appointments        Thursday 14:00 haircut
notifications       new_lead email, appointment_confirmed email
```

---

## 12. Evaluation / YouTube demo script (10–15 min)

Use this order so every member speaks:

| Min | Speaker | Show |
|-----|---------|------|
| 0–1 | All | Problem + one-line solution |
| 1–3 | PATHIRANA | Dashboard: register/settings OR seeded salon + inbox empty |
| 3–6 | PANKAJA | Live Telegram: send price question; show gateway logs / webhook |
| 6–8 | PADMASIRI | Chatbot reply + lead appears with score |
| 8–10 | PATHIRANA | Agent reply from UI; customer receives on Telegram |
| 10–12 | PATHIRANA + PADMASIRI | Book appointment; email in Mailtrap |
| 12–14 | PANKAJA | Architecture: monorepo + optional chatbot |
| 14–15 | All | Out of scope + future (WhatsApp, LangGraph stretch) |

---

## 13. Success criteria mapped to scenarios

| Success criterion (proposal) | Covered by |
|------------------------------|------------|
| Message → chatbot reply ≤ ~3s | Scenario A / C |
| Lead created, scored, visible live | Scenario A |
| Agent reply reaches original channel | Scenario A / D |
| Appointment booked in conversation | Scenario A / F |
| Email on new lead / appointment | Scenario A |
| Works without chatbot | Scenario E |
| Reproducible Docker / docs | Ops (all) |

---

## 14. Implementation order (so scenarios unlock)

```
1. Seed biz_001 + Telegram webhook          → PANKAJA (+ all)
2. Routing Gemini intents                     → PANKAJA
3. Chatbot one pricing flow                   → PADMASIRI
4. Lead create from chatbot                   → PADMASIRI
5. Dashboard inbox + WebSocket                → PATHIRANA + PANKAJA
6. Agent reply path                           → PATHIRANA + PANKAJA
7. Notification email                         → PATHIRANA
8. Appointment /chat + UI                     → PATHIRANA
9. Escalation + chatbot off                   → PANKAJA + PADMASIRI
10. Register / connect-bot UI (polish)        → PATHIRANA + PANKAJA
11. WhatsApp stretch                          → PANKAJA
```

---

## 15. One diagram for slides

```
Owner registers salon → connects Telegram bot
         ↓
Customer messages bot
         ↓
Gateway → Routing (Gemini)
         ↓
   ┌─────┼──────────────┐
   ↓     ↓              ↓
Chatbot Lead Mgr    Appointment
   └─────┼──────────────┘
         ↓
  Notification + Dashboard (agent)
         ↓
  Agent reply → Gateway → Customer
```

---

## 16. Glossary

| Term | Meaning |
|------|---------|
| `business_id` | Tenant key for one salon |
| Messenger | Customer identity on a channel |
| Escalation | Hand chat from bot to human agent |
| Flow | JSON chatbot script for a sector |
| Gateway | Orchestrator: webhooks in, replies out, WebSocket |
| Routing | AI intent + language + forward |

---

*Use this file as the shared “movie script” of the project. Member guides describe how to build your scenes; this file describes the whole film.*
