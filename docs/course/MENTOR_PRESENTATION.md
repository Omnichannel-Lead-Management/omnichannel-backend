---
marp: true
theme: default
paginate: true
size: 16:9
style: |
  section { font-size: 28px; }
  h1 { font-size: 44px; color: #1a365d; }
  h2 { font-size: 34px; color: #2c5282; }
  table { font-size: 22px; }
  li { margin-bottom: 0.3em; }
---

# Omnichannel Lead Management Platform
### Mentor Meeting — Project Overview

**Team**
- 230453V — PADMASIRI G.R.H.D.
- 230461T — PANKAJA D.L.K.
- 230465J — PATHIRANA D.P.C.N.

**PID-1 | CS3202 | 8 weeks | 3 members**

---

## 1. The Problem

Small businesses (salons, tutors, photographers) get inquiries from:
- WhatsApp · Telegram · Web forms

**Pain points**
- Messages scattered across apps → missed or late replies
- No single lead inbox or tracking
- No response after business hours → lost customers
- Enterprise CRM/chatbot tools are expensive and complex

**Our goal:** Simple, affordable platform for small vendors

---

## 2. Our Solution (One Line)

> Centralize all customer messages → auto-reply with chatbot OR hand to agent → track leads → book appointments

**Key idea**
- One dashboard for all channels
- Configurable chatbot (24/7) — **separate service**, core system still works without it
- Real-time agent console for manual replies

**Example:** Salon gets WhatsApp price question at 9 PM → chatbot answers → lead created → agent follows up next day

---

## 3. System Architecture

```
Customer (WhatsApp / Telegram / Web)
         ↓
   Messaging Gateway  ← receive & send messages
         ↓
   Routing Service    ← AI detects intent (Gemini)
         ↓
    ┌────┼────┬──────────┐
    ↓    ↓    ↓          ↓
 Chatbot Lead  Appointment
 Builder Manager Service
    └────┼────┘
         ↓
  Notification Service → Web Dashboard (agents)
```

**Backend monorepo + separate chatbot & dashboard** · Each area = one team member

---

## 4. What Each Service Does

| Service | Port | Responsibility |
|---------|------|----------------|
| Messaging Gateway | 3000 | Webhooks, channel adapters, WebSocket |
| Routing Service | 3001 | Intent classification, route to handler |
| Lead Manager | 3002 | Create leads, scoring, status, assignment |
| Chatbot Builder | 3003 | Flow engine, sector templates |
| Notification Service | 3004 | Email / SMS alerts |
| Appointment Service | 3005 | Scheduling, availability, reminders |
| Web Dashboard | 5173 | Agent UI, real-time inbox, reports |

---

## 5. Technology Stack

| Layer | Tools |
|-------|-------|
| **Backend** | Bun, Elysia.js, TypeScript |
| **Database** | SQLite + Drizzle ORM |
| **Frontend** | Vue 3, Pinia, Vite |
| **AI** | Google Gemini (intent routing) |
| **Channels** | Telegram Bot API, WhatsApp Business API |
| **Real-time** | WebSocket |
| **Deploy** | Docker Compose |

All **open source / free tier** — suitable for semester project

---

## 6. Team Division & Timeline

| Member | Services | Weeks 1–2 | Weeks 3–4 | Weeks 5–8 |
|--------|----------|-----------|-----------|-----------|
| **PANKAJA** | Gateway + Routing | Setup, webhooks | Gemini, routing | Integration, demo |
| **PADMASIRI** | Lead + Chatbot | DB schema, CRUD | Flow engine, scoring | Templates, polish |
| **PATHIRANA** | Dashboard + Notify + Appt | UI wireframes | Agent console, SMTP | Appointments, demo |

**Demo flow:** Customer message → chatbot reply → lead in dashboard → agent reply → appointment booked

---

## 7. Questions for Mentor

1. Is a **backend monorepo** (5 services) + separate chatbot + dashboard acceptable?
2. Telegram-first for demo — is WhatsApp integration expected for final demo?
3. Native mobile app vs mobile-responsive web dashboard — which is acceptable?
4. Any preferred documentation / diagram standards for mid-review?

**Thank you**
