# Feasibility Study Report

**Project Title:** Omnichannel Lead Management Platform with Configurable Chatbot Support for Small Service-Based Businesses  
**Project ID:** PID-1  
**Course:** CS3202 – Software Engineering Project  
**Date:** 8 July 2026  

**Prepared by:**

| Name | Index Number |
|------|--------------|
| PADMASIRI G.R.H.D. | 230453V |
| PANKAJA D.L.K. | 230461T |
| PATHIRANA D.P.C.N. | 230465J |

**Mentor:** _[To be filled]_

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Feasibility Study](#2-feasibility-study)
3. [Considerations](#3-considerations)
4. [References](#4-references)

---

## 1. Introduction

### 1.1 Overview of the Project

The Omnichannel Lead Management Platform is a proposed Software-as-a-Service (SaaS) solution designed for small and medium-scale service-based businesses such as salons, photographers, tutors, and home-service vendors. The platform centralizes customer inquiries received through multiple digital channels — including WhatsApp, Telegram, and web contact forms — into a single lead management interface.

The system enables business owners and staff to view, track, and respond to customer messages from one dashboard. An optional, configurable chatbot module provides automated responses to common inquiries outside business hours, using predefined conversation flows rather than unrestricted generative AI. When a customer requires human assistance, the conversation can be escalated to an agent through the same dashboard.

The platform is designed to be lightweight, affordable, and easy to use, addressing the gap between complex enterprise CRM systems and the informal messaging practices currently used by small vendors.

### 1.2 Objectives of the Project

The objectives of this project are to:

- Analyze the challenges faced by small service-based businesses in managing customer leads across multiple communication channels.
- Design and implement a centralized omnichannel lead management system.
- Provide automated initial responses through a configurable, flow-based chatbot that does not require programming knowledge from the vendor.
- Enable manual lead handling through a real-time agent console with lead scoring and status tracking.
- Support appointment booking and automated email or SMS notifications for staff.
- Evaluate how timely and consistent customer responses affect lead engagement and conversion potential.

### 1.3 The Need for the Project

Small service-based businesses increasingly depend on messaging platforms to attract and retain customers. Inquiries often arrive through WhatsApp, Telegram, social media direct messages, and web forms, but these channels operate independently. Messages are frequently missed, delayed, or forgotten because there is no single inbox or tracking mechanism.

Many vendors cannot respond outside working hours, which leads to lost customers who move to competitors offering faster replies. Existing CRM and chatbot products are often expensive, complex, and designed for enterprise users. They require technical expertise and lengthy configuration, making them unsuitable for small vendors with limited staff and budget.

There is a clear need for a simple, affordable platform that:

- Consolidates messages from multiple channels into one interface.
- Tracks leads from first contact through to booking or conversion.
- Provides optional 24×7 automated replies for common questions.
- Allows staff to take over conversations when human support is required.

### 1.4 Overview of Existing Systems and Technologies

Several existing products address parts of this problem, but none fully meet the needs of small service-based vendors in a simple and affordable manner.

| Existing Solution | Strengths | Limitations for Small Vendors |
|-------------------|-----------|-------------------------------|
| **HubSpot CRM / Zoho CRM** | Full lead management, pipelines, reporting | High cost, complex setup, oriented toward sales teams |
| **ManyChat / Chatfuel** | Chatbot automation on messaging channels | Limited lead management; focused on marketing bots |
| **WhatsApp Business App** | Free, widely used | Single channel only; no lead scoring or multi-agent console |
| **Freshdesk / Zendesk** | Ticketing and support workflows | Expensive; over-engineered for small salons and tutors |
| **Custom spreadsheets + personal WhatsApp** | Free, familiar | No automation, no central inbox, poor scalability |

The proposed system combines omnichannel messaging, lead tracking, optional chatbot automation, and appointment booking in one integrated platform targeted specifically at small service businesses.

**Technology considerations:**

The development team has selected open-source and free-tier technologies suitable for a semester-scale project:

| Category | Selected Technology | Rationale |
|----------|---------------------|-----------|
| Backend runtime | Bun | Fast TypeScript-native runtime with low setup overhead |
| API framework | Elysia.js | Lightweight, type-safe HTTP and WebSocket APIs |
| Database | SQLite with Drizzle ORM | Embedded storage; no separate database server required |
| Frontend | Vue 3, Pinia, Vite | Reactive UI suitable for real-time dashboards |
| AI (intent routing) | Google Gemini API | Cost-effective intent classification; free tier available |
| Messaging channels | Telegram Bot API, WhatsApp Business API | Telegram for development; WhatsApp for production demo |
| Real-time communication | WebSocket | Low-latency agent notifications and replies |
| Deployment | Docker Compose | Single-command local and demo deployment |

The backend is organized as a monorepo containing core services (gateway, routing, lead manager, notification, and appointment modules), with the chatbot engine maintained as a separate optional component. This structure supports parallel development while keeping automation isolated from core lead management.

### 1.5 Scope of the Project

#### User Roles and Functionalities

| User Role | Functionalities |
|-----------|-----------------|
| **Business Owner** | Configure chatbot flows and sector templates; view lead reports and analytics; manage business settings |
| **Agent / Staff** | View real-time inbox; reply to customer messages; assign and update lead status; handle escalated conversations |
| **Customer (End User)** | Send inquiries via WhatsApp, Telegram, or web chat; receive automated or human replies; book appointments |
| **System Administrator** | Monitor service health and manage tenants (development scope only) |

#### In Scope

- Web dashboard with mobile-responsive design for agents and owners.
- Backend services for messaging, AI routing, lead management, notifications, and appointments.
- Telegram integration (primary channel for development and demo).
- WhatsApp integration (secondary channel, subject to API access).
- Configurable flow-based chatbot with sector templates (salon, tutoring, photography).
- Multi-tenant data isolation using `business_id` across all data stores.
- Real-time agent notifications via WebSocket.
- Email notifications for new leads and appointments.
- Technical documentation: architecture, API reference, and setup guide.

#### Out of Scope

- Advanced generative AI or fully autonomous conversational agents.
- Enterprise CRM features such as sales forecasting and ERP integration.
- Payment processing and subscription billing.
- Facebook Messenger and Instagram DM integration (deferred; architecture supports future extension).
- Production-grade cloud deployment with auto-scaling (Docker Compose used for demonstration).
- Native mobile applications (mobile-responsive web dashboard is the primary interface).

### 1.6 Deliverables

The project will produce the following deliverables:

| # | Deliverable | Description |
|---|-------------|-------------|
| 1 | Project Proposal and Feasibility Report | Initial project definition and feasibility analysis |
| 2 | Project Vision Document | High-level vision and stakeholder view |
| 3 | Project Schedule (Gantt chart) | Timeline with milestones and task allocation |
| 4 | System Requirement Specification (SRS) | Functional and non-functional requirements |
| 5 | System Architecture and Design Document | Component design, data flows, and database schema |
| 6 | Working software prototype | Functional omnichannel platform with integrated services |
| 7 | Status Assessment Documents | Progress reports at mid-project milestones |
| 8 | Technical Documentation | API reference, setup guide, and architecture diagrams |
| 9 | Final Project Report | Evaluation of solution effectiveness |
| 10 | Mid-way and Final Demonstrations | Live demonstrations of system capabilities |

**Software outputs:**

- A web-based agent dashboard for lead and conversation management.
- A backend platform comprising messaging gateway, AI routing, lead manager, notification, and appointment modules.
- A separate optional chatbot builder service with sector-specific conversation templates.
- Docker Compose configuration for reproducible local deployment.

---

## 2. Feasibility Study

This section evaluates whether the proposed project can be successfully completed within the available resources, timeline, and technical constraints.

### 2.1 Financial Feasibility

The project is financially feasible because all core development tools and runtime environments are open source and freely available.

| Cost Item | Estimated Cost | Notes |
|-----------|----------------|-------|
| Development tools (Bun, VS Code, Git, Docker) | LKR 0 | Open source |
| Database (SQLite) | LKR 0 | Embedded; no licensing |
| Frontend framework (Vue 3, Vite) | LKR 0 | Open source |
| Google Gemini API | LKR 0 (development) | Free tier sufficient for development and demonstration |
| Telegram Bot API | LKR 0 | Free |
| Email testing (Mailtrap / Gmail app password) | LKR 0 | Free tier or existing account |
| WhatsApp Business API | Variable | May require Meta business verification; Telegram used as primary demo channel |
| Cloud hosting (demo) | LKR 0–minimal | Docker Compose on local or free-tier cloud if needed |
| Hardware (development laptops) | Already available | Team members' existing equipment |

No significant financial investment is required from the client or project sponsors. The only potential cost is WhatsApp Business API access for production-level WhatsApp integration, which is mitigated by using Telegram as the primary demonstration channel.

**Conclusion:** The project is financially feasible. All essential components can be developed and demonstrated at zero or negligible cost.

### 2.2 Technical Feasibility

The project is technically feasible based on the following factors:

**Proven technologies:** Bun, Elysia.js, Vue 3, SQLite, and Docker Compose are mature, well-documented technologies with active community support. Google Gemini provides a documented API for intent classification, and the Telegram Bot API is straightforward to integrate for webhook-based messaging.

**Existing implementation progress:** Core components have already been initiated:

- The messaging gateway supports Telegram webhooks, message storage, WebSocket agent channels, and orchestration logic.
- The routing service integrates Google Gemini for intent classification, multilingual detection (English, Sinhala, Tamil), and downstream service forwarding with circuit breaker protection.
- Backend repository structure (monorepo with shared packages) and service skeletons are in place.

**Architecture suitability:** The modular backend design allows each team member to work on distinct components (gateway and routing, lead manager and chatbot, dashboard and support services) while sharing common types and deployment configuration. The chatbot is isolated as an optional module, ensuring that core lead management remains operational even when automation is disabled.

**Integration complexity:** Service-to-service communication uses simple HTTP REST calls and WebSocket, avoiding complex message queue infrastructure. SQLite eliminates the need for a separate database server, reducing deployment complexity.

**Potential technical challenges and mitigations:**

| Challenge | Mitigation |
|-----------|------------|
| WhatsApp API approval delays | Use Telegram as primary demo channel |
| Gemini API rate limits | Circuit breaker with keyword-based fallback routing |
| Real-time WebSocket reliability | Gateway manages connection lifecycle; agents receive reconnect prompts |
| Multi-tenant data isolation | All database queries filter by `business_id` |

**Conclusion:** The project is technically feasible. Selected technologies match the project requirements, existing code demonstrates viability of core flows, and identified challenges have practical mitigation strategies.

### 2.3 Resource and Time Feasibility

#### Human Resources

The project team consists of three members with responsibilities divided as follows:

| Member | Index | Primary Components | Estimated Effort |
|--------|-------|-------------------|------------------|
| PANKAJA D.L.K. | 230461T | Messaging Gateway, Routing Service, channel integrations | ~40% |
| PADMASIRI G.R.H.D. | 230453V | Lead Manager, Chatbot Builder, scoring and flow engine | ~35% |
| PATHIRANA D.P.C.N. | 230465J | Web Dashboard, Notification Service, Appointment Service | ~35% |

This division allows parallel development with minimal overlap and clear ownership of components.

#### Hardware and Software Resources

| Resource | Requirement | Availability |
|----------|-------------|--------------|
| Development laptops | 3 machines with 8 GB+ RAM | Available to team members |
| Bun runtime (≥ 1.0) | Backend execution | Freely installable |
| Node.js (≥ 18) | Frontend tooling | Freely installable |
| Docker and Docker Compose | Containerized deployment | Freely installable |
| Git and GitHub | Version control and collaboration | Available |
| Internet access | API calls, webhooks (ngrok for local testing) | Available |
| Google Gemini API key | Intent classification | Free tier registration |
| Telegram Bot Token | Messaging channel | Free via BotFather |

#### Timeline

The project duration is **8 weeks**, organized into four phases:

| Phase | Weeks | Focus | Key Milestone |
|-------|-------|-------|---------------|
| Setup and Planning | 1–2 | Environment, architecture, repository structure | Service skeletons operational |
| Core Features | 3–4 | Independent service implementation | CRUD APIs, webhooks, chatbot engine, dashboard UI |
| Integration | 5–6 | End-to-end message flow, WebSocket, notifications | Full customer → bot → lead → agent flow |
| Polish and Demo | 7–8 | Bug fixes, documentation, presentation | Final demonstration |

| Milestone | Target Week |
|-----------|-------------|
| Mid-Demo 1 | End of Week 2 |
| Mid-Demo 2 | End of Week 4 |
| Mid-Demo 3 | End of Week 6 |
| Final Demo | End of Week 8 |

The phased schedule includes buffer time in Weeks 7–8 for integration issues and documentation. Given that gateway and routing components are already partially implemented, the team has a realistic foundation to meet the Week 4 and Week 6 milestones.

**Conclusion:** The project is feasible within the 8-week timeline and available human and technical resources, provided the team maintains weekly progress reviews and adheres to the phased plan.

### 2.4 Risk Feasibility

| Risk | Likelihood | Impact | Mitigation Strategy |
|------|------------|--------|---------------------|
| WhatsApp Business API access delayed or denied | Medium | Medium | Prioritize Telegram for all development and demonstration; treat WhatsApp as stretch goal |
| Gemini API downtime or rate limiting | Low | Medium | Implement circuit breaker and keyword-based fallback routing in the routing service |
| Integration failures between services | Medium | High | Define clear API contracts early; use Docker Compose for consistent integration testing from Week 5 |
| Scope creep (too many features) | Medium | High | Strict adherence to in-scope list; defer Facebook/Instagram and native mobile app |
| Team member unavailability | Low | Medium | Document all components; cross-train on critical integration points (gateway ↔ routing) |
| Chatbot module failure | Low | Low | Chatbot is optional; core lead management and manual agent replies function independently |
| Data loss during development | Low | Low | SQLite files backed up in version control exclusions; use Docker volumes for persistence |
| Security vulnerabilities in webhook endpoints | Medium | Medium | Validate webhook signatures; enforce tenant isolation on all database queries |

The modular architecture reduces overall project risk: failure or delay in one component (e.g., chatbot or appointment booking) does not prevent demonstration of core lead management functionality.

**Conclusion:** Identified risks are manageable with the proposed mitigation strategies. No risk appears severe enough to make the project infeasible.

### 2.5 Social/Legal Feasibility

**Social feasibility:** The platform addresses a genuine need among small business owners who struggle with fragmented customer communication. The solution promotes better customer service, faster response times, and improved lead conversion for local service providers. Multilingual support (English, Sinhala, Tamil) makes the system accessible to a broader user base in Sri Lanka.

**Legal and ethical considerations:**

| Concern | Approach |
|---------|----------|
| **Data privacy** | Customer message data stored per business with tenant isolation; no cross-business data access |
| **Copyright and licensing** | All development tools and libraries are open source with permissive licenses (MIT, Apache) |
| **WhatsApp / Telegram Terms of Service** | Platform adapters comply with official API usage policies; no unauthorized scraping or automation |
| **Google Gemini API Terms** | AI used only for intent classification; customer data sent to Gemini limited to message text for routing |
| **Email and SMS regulations** | Notifications sent only to opted-in business staff; no unsolicited marketing messages |
| **Personal data handling** | Customer phone numbers and names stored only for lead management purposes within the business account |

No patents or proprietary restrictions block the use of selected technologies. The project does not involve processing of sensitive categories of personal data beyond standard business contact information.

**Conclusion:** The project is socially beneficial and legally feasible, provided data privacy and platform API terms are respected during implementation.

---

## 3. Considerations

The following non-functional requirements are primary concerns for the system design:

### 3.1 Performance

- Customer messages should receive an automated chatbot response within **3 seconds** under normal conditions.
- The agent dashboard should display new leads and messages in **real time** via WebSocket without manual page refresh.
- The routing service should handle concurrent messages from multiple customers without blocking the gateway.

### 3.2 Security

- All agent API and WebSocket connections require authentication.
- Webhook endpoints validate platform signatures (Telegram secret token, WhatsApp HMAC).
- Multi-tenant data isolation enforced at the database query level using `business_id`.
- Environment variables used for API keys and secrets; no credentials stored in source code.

### 3.3 Usability

- The agent dashboard must be usable on mobile browsers, as small business staff often reply from phones.
- Chatbot flow configuration should use visual templates rather than code, enabling non-technical business owners to customize responses.
- Conversation history and lead status should be visible in a single view to minimize context switching.

### 3.4 Reliability and Fault Tolerance

- The routing service implements a circuit breaker pattern to prevent cascading failures when downstream services or Gemini API are unavailable.
- The chatbot module is optional; manual agent replies continue to function when automation is disabled or unavailable.
- Health check endpoints on all services support monitoring during demonstration and development.

### 3.5 Maintainability

- Backend monorepo structure with shared types reduces code duplication across services.
- Each service module has a single responsibility and well-defined API contract.
- Comprehensive documentation (architecture, API reference, setup guide) ensures reproducibility beyond the project duration.

### 3.6 Scalability (Future)

While production-scale auto-scaling is out of scope, the modular architecture allows individual services to be scaled or replaced independently in future iterations. SQLite is sufficient for the demonstration scope; migration to PostgreSQL is supported by the Drizzle ORM abstraction if needed later.

---

## 4. References

1. Department of Computer Science, University of Peradeniya, *CS3202 Software Engineering Project — PID-1: Omnichannel Lead Management Platform with Configurable Chatbot Support*, Project Specification Document, 2026.

2. Google, *Gemini API Documentation*, Google AI for Developers, [https://ai.google.dev/](https://ai.google.dev/) (Accessed on 8 July 2026).

3. Telegram, *Telegram Bot API*, [https://core.telegram.org/bots/api](https://core.telegram.org/bots/api) (Accessed on 8 July 2026).

4. Meta, *WhatsApp Business Platform Documentation*, [https://developers.facebook.com/docs/whatsapp](https://developers.facebook.com/docs/whatsapp) (Accessed on 8 July 2026).

5. Oven, *Bun Runtime Documentation*, [https://bun.sh/docs](https://bun.sh/docs) (Accessed on 8 July 2026).

6. ElysiaJS, *Elysia Framework Documentation*, [https://elysiajs.com/](https://elysiajs.com/) (Accessed on 8 July 2026).

7. Vue.js, *Vue 3 Documentation*, [https://vuejs.org/](https://vuejs.org/) (Accessed on 8 July 2026).

8. Drizzle Team, *Drizzle ORM Documentation*, [https://orm.drizzle.team/](https://orm.drizzle.team/) (Accessed on 8 July 2026).

9. HubSpot, *CRM Software Overview*, [https://www.hubspot.com/products/crm](https://www.hubspot.com/products/crm) (Accessed on 8 July 2026).

10. ManyChat, *Chatbot Platform*, [https://manychat.com/](https://manychat.com/) (Accessed on 8 July 2026).

---

## Conclusion

Based on the analysis presented in this report, the Omnichannel Lead Management Platform project is **feasible** across all evaluated dimensions:

| Feasibility Type | Assessment |
|------------------|------------|
| Financial | Feasible — zero or negligible cost using open-source tools and free-tier APIs |
| Technical | Feasible — proven technologies; core gateway and routing components already initiated |
| Resource and Time | Feasible — 3-member team with clear task division and realistic 8-week phased schedule |
| Risk | Feasible — identified risks have practical mitigation strategies |
| Social/Legal | Feasible — addresses genuine business need; no legal barriers identified |

The project team recommends proceeding with development according to the proposed architecture, timeline, and scope defined in this document.

---

*Document prepared for CS3202 Software Engineering Project — Feasibility Study submission.*
