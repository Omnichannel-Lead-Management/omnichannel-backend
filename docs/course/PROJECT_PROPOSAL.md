# Project Proposal

**Project ID:** PID-1  
**Project Title:** Omnichannel Lead Management Platform with Configurable Chatbot Support for Small Service-Based Businesses  
**Course:** CS3202 – Software Engineering Project  
**Team Size:** 3 members  
**Duration:** 8 weeks (semester project)

---

## 1. Introduction

Small and medium-scale service providers — including salons, photographers, tutors, and home-service vendors — increasingly depend on digital channels such as WhatsApp, Facebook Messenger, Instagram Direct Messages, and web contact forms to attract customers. These channels operate independently, which makes it difficult for vendors with limited staff to track inquiries, respond promptly, and convert interest into bookings.

This project proposes the design and implementation of a **Software-as-a-Service (SaaS) omnichannel lead management platform** aimed at small service-based businesses. The system will centralize customer inquiries from multiple messaging channels into a single interface, provide tools to manage and respond to leads, and optionally automate initial responses through a **configurable, flow-based chatbot** that operates 24×7 without requiring programming knowledge from the vendor.

The platform uses a **backend monorepo** with five core services (Messaging Gateway, Routing Service, Lead Manager, Notification Service, Appointment Service), plus a **separate chatbot builder** and **web dashboard**. The chatbot remains an optional, independently deployable service so core lead management still works when automation is disabled.

The solution addresses a documented gap in the market: existing CRM and chatbot products are often complex, expensive, and oriented toward enterprise users, making them impractical for small vendors who need simplicity, affordability, and continuous customer engagement.

---

## 2. Problem Statement

Small service-based businesses face significant challenges in managing customer leads generated across multiple communication platforms. Messages are often missed, delayed, or forgotten due to fragmented communication tools and the absence of centralized lead management. Additionally, many vendors are unable to provide instant responses outside working hours, which negatively impacts customer trust and conversion rates.

| Challenge | Impact |
|-----------|--------|
| Fragmented communication across platforms | Messages are missed, delayed, or forgotten |
| No centralized lead tracking | Poor follow-up and lost conversion opportunities |
| Limited staff availability | No responses outside business hours |
| Complex existing CRM/chatbot tools | High cost and technical barrier to adoption |

While existing CRM and chatbot solutions attempt to address these issues, they are often complex, costly, and designed for enterprise-level usage. Such solutions require technical expertise and extensive configuration, making them impractical for small vendors. There is a clear need for a simple, affordable, and user-friendly system that enables centralized lead handling and ensures continuous customer engagement.

---

## 3. Proposed Solution

The proposed platform will:

1. **Centralize** customer inquiries from WhatsApp, Telegram, and web channels into one lead inbox.
2. **Route** incoming messages using intent detection (Google Gemini API) to the appropriate handler — chatbot, lead manager, or appointment service.
3. **Automate** common inquiries through sector-specific chatbot flows (salon, photography, tutoring) configurable via predefined templates.
4. **Enable manual handling** through a real-time agent console where vendors or staff can reply, assign leads, and track status.
5. **Support appointment booking** and automated email/SMS notifications.
6. **Provide basic reporting** on lead volume, status, and conversion.

### 3.1 System Architecture Overview

The platform adopts a modular service architecture (backend monorepo + separate chatbot and dashboard) to enable parallel development by a three-member team and clear separation of concerns.

```
Customer (WhatsApp / Telegram / Web)
        │
        ▼
┌─────────────────────┐
│  Messaging Gateway  │  Port 3000 — Webhooks, adapters, WebSocket
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│   Routing Service   │  Port 3001 — Gemini intent detection
└──────────┬──────────┘
           │
     ┌─────┼─────┬─────────────┐
     ▼     ▼     ▼             ▼
 Chatbot  Lead   Appointment   (fallback)
 Builder  Manager Service
 3003     3002    3005
     │     │         │
     └─────┼─────────┘
           ▼
┌─────────────────────┐
│ Notification Service│  Port 3004 — Email / SMS
└─────────────────────┘
           │
           ▼
┌─────────────────────┐
│   Web Dashboard     │  Port 5173 — Agent console, analytics
└─────────────────────┘
```

**Design principles:**

- Service independence and single responsibility
- Loose coupling via REST APIs and WebSocket
- Multi-tenant data isolation per business
- Event-driven real-time updates for agents
- Fault tolerance through circuit breakers and retry logic

---

## 4. Objectives

The main objectives of this project are:

- To analyze the challenges faced by small service-based businesses in managing customer leads across multiple channels.
- To design a centralized system for handling omnichannel customer inquiries.
- To implement a lightweight lead management platform with both manual and automated response capabilities.
- To develop a configurable chatbot system with sector-based conversation templates.
- To evaluate how instant and consistent responses affect customer engagement and lead conversion.

---

## 5. Scope

### 5.1 In Scope

| Component | Description |
|-----------|-------------|
| **Web Dashboard** | Administrative and agent interface: lead overview, real-time inbox, basic reporting, template and media management |
| **Mobile-Responsive Web Access** | Primary vendor interface optimized for mobile browsers; native mobile app as stretch goal if schedule permits |
| **Backend Services** | Messaging Gateway, Routing, Lead Manager, Notification, Appointment (monorepo); Chatbot Builder (separate) |
| **Channel Integration** | Telegram (primary for development/demo); WhatsApp (secondary); web chat widget |
| **Chatbot Module** | Separate service; flow-based automation; sector templates; no advanced generative AI |
| **Multi-Tenancy** | Data isolation per business via `business_id` across all services |
| **Real-Time Updates** | WebSocket-based agent notifications |
| **Documentation** | Architecture, API reference, setup guide, final project report |

### 5.2 Out of Scope

- Advanced generative AI or fully autonomous conversational agents
- Enterprise-scale CRM features (pipeline automation, sales forecasting, ERP integrations)
- Payment processing and subscription billing systems
- Facebook Messenger and Instagram DM integration (deferred; architecture supports future extension)
- Production-grade cloud deployment (Kubernetes, auto-scaling) — Docker Compose used for demo

---

## 6. Target Users

| User Type | Role |
|-----------|------|
| **Business Owner** | Configures chatbot flows, views reports, manages templates |
| **Agent / Staff** | Handles live conversations, assigns and updates leads |
| **Customer (End User)** | Sends inquiries via WhatsApp, Telegram, or web |
| **System Administrator** | Manages tenants, monitors service health (development scope only) |

---

## 7. Expected Outcomes

By project completion, the team will deliver:

- A functional prototype of the omnichannel lead management platform
- A configurable chatbot capable of handling common customer inquiries 24×7
- Technical documentation including system architecture and design decisions
- A final project report analyzing solution effectiveness
- A demonstration using realistic business scenarios (e.g., salon pricing inquiry → chatbot response → lead creation → agent handover → appointment booking)

---

## 8. Timeline

The project follows an **8-week phased schedule** aligned with continuous evaluation milestones.

| Phase | Weeks | Focus | Key Deliverable |
|-------|-------|-------|-----------------|
| **Phase 1: Setup & Planning** | 1–2 | Environment setup, architecture review, repository structure, API design | All services running locally; basic health checks passing |
| **Phase 2: Core Features** | 3–4 | Independent service implementation | CRUD APIs, webhook receivers, chatbot flow engine, dashboard skeleton |
| **Phase 3: Integration** | 5–6 | End-to-end message flow, WebSocket, cross-service communication | Customer message → routing → chatbot/lead → agent notification |
| **Phase 4: Polish & Demo** | 7–8 | Bug fixes, UI polish, documentation, presentation preparation | Working demo; final report; mid/final demonstrations |

### Milestone Demonstrations

| Milestone | Timing | Expected Progress |
|-----------|--------|-------------------|
| Mid-Demo 1 | End of Week 2 | Environment and service skeletons operational |
| Mid-Demo 2 | End of Week 4 | Core features working independently |
| Mid-Demo 3 | End of Week 6 | Full integration flow demonstrated |
| Final Demo | End of Week 8 | Complete system with realistic business scenario |

---

## 9. Deliverables

| # | Deliverable | Timing |
|---|-------------|--------|
| 1 | Project Proposal & Feasibility Report | Week 1 |
| 2 | Project Vision Document | Week 2 |
| 3 | Project Schedule (Gantt chart) | Week 2 |
| 4 | System Requirement Specification (SRS) | Week 3 |
| 5 | System Architecture & Design Document | Week 4 |
| 6 | Working services prototype | Weeks 5–7 |
| 7 | Status Assessment Documents | Weeks 4, 6 |
| 8 | Technical Documentation (API, setup, architecture) | Week 7 |
| 9 | Final Project Report | Week 8 |
| 10 | Mid-way and Final Demonstrations | As scheduled |

---

## 10. Resources

### 10.1 Human Resources

| Role | Responsibility | Estimated Effort |
|------|----------------|------------------|
| **PANKAJA D.L.K. (230461T)** | Messaging Gateway, Routing Service, channel integrations, AI routing | ~40% |
| **PADMASIRI G.R.H.D. (230453V)** | Lead Manager, Chatbot Builder, scoring algorithm, flow engine | ~35% |
| **PATHIRANA D.P.C.N. (230465J)** | Web Dashboard, Notification Service, Appointment Service, UI/UX | ~35% |

**Team Members:**

| Member | Name | Index Number | Email |
|--------|------|--------------|-------|
| Member 1 | PANKAJA D.L.K. | 230461T | _[To be filled]_ |
| Member 2 | PADMASIRI G.R.H.D. | 230453V | _[To be filled]_ |
| Member 3 | PATHIRANA D.P.C.N. | 230465J | _[To be filled]_ |

**Mentor:** _[To be filled]_

### 10.2 Technical Resources

| Category | Tools / Technologies |
|----------|---------------------|
| **Runtime & Backend** | Bun, Elysia.js, TypeScript |
| **Database** | SQLite with Drizzle ORM |
| **Frontend** | Vue 3, Pinia, Vite, Chart.js |
| **AI** | Google Gemini API (intent classification) |
| **Messaging** | Telegram Bot API, WhatsApp Business API |
| **Real-Time** | WebSocket |
| **DevOps** | Docker, Docker Compose, Git, GitHub |
| **Documentation** | Markdown, UML diagram tools (draw.io / PlantUML) |
| **IDE** | VS Code |

### 10.3 External Services

- Google Gemini API (free tier for development)
- Telegram Bot API (free)
- SMTP provider for email notifications (e.g., Gmail app password or Mailtrap for testing)
- ngrok or similar for local webhook tunneling during development

All selected tools are open source or offer free tiers, consistent with course guidelines requiring tools that remain accessible beyond the module period.

---

## 11. Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Backend Runtime | Bun | Fast TypeScript-native runtime |
| API Framework | Elysia.js | Lightweight, type-safe microservice APIs |
| Database | SQLite + Drizzle ORM | Embedded storage with type-safe queries |
| Frontend | Vue 3 + Pinia + Vite | Agent dashboard and admin interface |
| AI | Google Gemini | Intent classification and routing |
| Real-Time | WebSocket | Live agent notifications and replies |
| Containers | Docker Compose | Local development and demo deployment |

---

## 12. Work Breakdown

| Member | Services | Key Tasks |
|--------|----------|-----------|
| **PANKAJA** | Messaging Gateway (3000), Routing Service (3001) | Webhook handlers, platform adapters, Gemini integration, WebSocket server |
| **PADMASIRI** | Lead Manager (3002), Chatbot Builder (3003) | Lead CRUD, scoring algorithm, flow engine, sector templates |
| **PATHIRANA** | Web Dashboard (5173), Notification (3004), Appointment (3005) | Vue UI, agent console, email notifications, scheduling |

---

## 13. Success Criteria

The project will be considered successful when:

1. A customer sends a message via Telegram (or WhatsApp) and receives an automated chatbot response within 3 seconds.
2. A lead is automatically created, scored, and visible in the agent dashboard in real time.
3. An agent can reply from the web dashboard and the customer receives the message on the original channel.
4. An appointment can be booked through the conversation flow.
5. An email notification is triggered for a new lead or appointment.
6. System architecture and API documentation are complete and reproducible via Docker Compose.

---

## 14. References

1. Course Project Description — PID-1: Omnichannel Lead Management Platform with Configurable Chatbot Support (Department specification document).
2. Omnichannel Lead Management Platform — Backend docs (`omnichannel-backend/docs/`): Architecture, API, Setup, and Team Guides.
3. Google Gemini API Documentation — https://ai.google.dev/
4. Telegram Bot API Documentation — https://core.telegram.org/bots/api
5. Bun Runtime Documentation — https://bun.sh/docs
6. Elysia.js Framework Documentation — https://elysiajs.com/
7. Vue.js 3 Documentation — https://vuejs.org/
8. Drizzle ORM Documentation — https://orm.drizzle.team/

---

*Document prepared for CS3202 Software Engineering Project submission. Fill in team member details before final submission.*
