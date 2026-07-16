# Team Member Guides

Detailed work packages for **PID-1 Omnichannel Lead Management Platform**.

## Start here — full project story

**[FULL_PROJECT_SCENARIOS.md](./FULL_PROJECT_SCENARIOS.md)** — complete end-to-end scenarios (register → Telegram → chatbot → lead → agent → appointment → demo script).

**[ONBOARDING_NEW_SALON.md](./ONBOARDING_NEW_SALON.md)** — how a new salon registers and connects Telegram/WhatsApp bots.

## Member guides

| Member | Index | Guide | Focus |
|--------|-------|-------|--------|
| **PANKAJA D.L.K.** | 230461T | [PANKAJA_GATEWAY_ROUTING.md](./PANKAJA_GATEWAY_ROUTING.md) | Gateway + Routing (Gemini) |
| **PADMASIRI G.R.H.D.** | 230453V | [PADMASIRI_LEAD_CHATBOT.md](./PADMASIRI_LEAD_CHATBOT.md) | Lead Manager + Chatbot |
| **PATHIRANA D.P.C.N.** | 230465J | [PATHIRANA_DASHBOARD.md](./PATHIRANA_DASHBOARD.md) | Dashboard + Notification + Appointment |

## Chatbot tech decision

| Choice | Decision |
|--------|----------|
| **Primary** | Custom **JSON flow engine** (state machine) |
| **Not required** | LangChain as core chatbot |
| **Stretch only** | LangGraph (template replies still) |

## Shared repos

```
omnichannel-backend/   ← PANKAJA + PADMASIRI (lead) + PATHIRANA (notify/appt)
chatbot-builder/       ← PADMASIRI
web-dashboard/         ← PATHIRANA
```
