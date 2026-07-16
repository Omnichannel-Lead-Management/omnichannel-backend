# Project Overview & Documentation Index
## Omnichannel Lead Management Platform - Semester Project

**Team Size:** 3 Members
**Duration:** 8 Weeks
**Type:** Microservices Architecture

---

## 📚 Documentation Available

### Essential Reading (Read in This Order)

1. **README.md** - Start here!
   - Project overview
   - What problem we're solving
   - High-level architecture
   - Microservices overview
   - Technology stack
   - Team division suggestions

2. **SETUP_GUIDE.md** - How to get started
   - Install prerequisites
   - Setup each microservice
   - Get API keys
   - Test the setup
   - Common issues & solutions

3. **ARCHITECTURE.md** - Technical deep dive
   - System architecture
   - Detailed data flows
   - Database schemas
   - Service communication
   - Security architecture

4. **API_DOCUMENTATION.md** - API reference
   - All endpoints for all services
   - Request/response formats
   - Authentication
   - Error handling
   - Rate limits

5. **TEAM_GUIDE.md** - Collaboration guide
   - Team structure
   - Weekly schedule
   - Git workflow
   - Communication plan
   - Demo preparation

6. **PROJECT_OVERVIEW.md** - This file!
   - Quick reference
   - Documentation index
   - Folder structure

---

## 🏗️ Project Structure

```
Omnichannel-Lead-Management/
│
├── 📄 README.md                    # Main project overview
├── 📄 ARCHITECTURE.md              # System architecture details
├── 📄 API_DOCUMENTATION.md         # Complete API reference
├── 📄 SETUP_GUIDE.md               # Setup instructions
├── 📄 TEAM_GUIDE.md                # Team collaboration guide
├── 📄 PROJECT_OVERVIEW.md          # This file
│
├── 📁 messaging-gateway/           # Service 1 (Port 3000)
│   ├── src/
│   │   ├── controllers/           # Webhook handlers
│   │   ├── services/              # Platform adapters
│   │   ├── models/                # Database schemas
│   │   ├── routes/                # API routes
│   │   ├── types/                 # TypeScript types
│   │   ├── utils/                 # Helper functions
│   │   ├── config/                # Configuration
│   │   └── index.ts               # Entry point
│   ├── tests/
│   └── README.md                  # Service-specific docs
│
├── 📁 routing-service/             # Service 2 (Port 3001)
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── types/
│   │   ├── utils/
│   │   ├── config/
│   │   └── index.ts
│   ├── tests/
│   └── README.md
│
├── 📁 lead-manager/                # Service 3 (Port 3002)
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── types/
│   │   ├── utils/
│   │   ├── config/
│   │   └── index.ts
│   ├── tests/
│   └── README.md
│
├── 📁 chatbot-builder/             # Service 4 (Port 3003)
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── types/
│   │   ├── utils/
│   │   ├── config/
│   │   ├── engine/                # Flow execution engine
│   │   └── index.ts
│   ├── tests/
│   └── README.md
│
├── 📁 notification-service/        # Service 5 (Port 3004)
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── types/
│   │   ├── utils/
│   │   ├── config/
│   │   ├── adapters/              # Email, SMS, Push
│   │   └── index.ts
│   ├── tests/
│   └── README.md
│
├── 📁 appointment-service/         # Service 6 (Port 3005)
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── models/
│   │   ├── routes/
│   │   ├── types/
│   │   ├── utils/
│   │   ├── config/
│   │   └── index.ts
│   ├── tests/
│   └── README.md
│
├── 📁 web-dashboard/               # Frontend (Port 5173)
│   ├── src/
│   │   ├── components/            # Vue components
│   │   ├── views/                 # Pages
│   │   ├── stores/                # Pinia state management
│   │   ├── services/              # API clients
│   │   ├── types/                 # TypeScript types
│   │   ├── utils/                 # Helper functions
│   │   ├── assets/                # Images, fonts
│   │   ├── router/                # Vue Router
│   │   ├── App.vue
│   │   └── main.ts
│   ├── public/
│   └── README.md
│
├── 📁 shared/                      # Shared code
│   ├── types/                     # Common types
│   ├── utils/                     # Shared utilities
│   ├── constants/                 # Constants
│   ├── schemas/                   # DB schemas
│   └── data/                      # SQLite databases
│       ├── messaging.db
│       ├── leads.db
│       ├── chatbot.db
│       ├── appointments.db
│       └── notifications.db
│
├── 📁 deployment/                  # Deployment configs
│   ├── docker/
│   ├── kubernetes/
│   └── docker-compose.yml
│
└── 📁 docs/                        # Additional docs
    ├── api/
    ├── guides/
    └── diagrams/
```

---

## 🎯 What Each Service Does

### 1. Messaging Gateway (Port 3000)
**Owner:** Member 1
- Receives messages from WhatsApp, Telegram, Discord, Web
- Stores message history
- Sends responses back to customers
- WebSocket server for real-time updates

### 2. Routing Service (Port 3001)
**Owner:** Member 1
- AI-powered intent detection using Google Gemini
- Routes messages to appropriate service
- Language detection
- Circuit breaker for reliability

### 3. Lead Manager (Port 3002)
**Owner:** Member 2
- Create and manage leads
- Lead scoring algorithm
- Agent assignment
- Lead status tracking (new → contacted → qualified → converted)

### 4. Chatbot Builder (Port 3003)
**Owner:** Member 2
- Execute chatbot flows
- Manage chatbot templates
- Flow engine (state machine)
- Integration with messaging gateway

### 5. Notification Service (Port 3004)
**Owner:** Member 3
- Send email notifications
- Send SMS notifications
- Template management
- Delivery tracking

### 6. Appointment Service (Port 3005)
**Owner:** Member 3
- Schedule appointments
- Check availability
- Send reminders
- Handle cancellations

### 7. Web Dashboard (Port 5173)
**Owner:** Member 3
- Agent console
- Lead management UI
- Real-time updates via WebSocket
- Analytics dashboard

---

## 🔑 Key Technologies

### Backend
- **Runtime:** Bun
- **Framework:** Elysia.js
- **Database:** SQLite + Drizzle ORM
- **Language:** TypeScript
- **AI:** Google Gemini API
- **Real-time:** WebSocket

### Frontend
- **Framework:** Vue 3
- **State:** Pinia
- **Build Tool:** Vite
- **Language:** TypeScript
- **Charts:** Chart.js

### DevOps
- **Containers:** Docker
- **Orchestration:** Docker Compose
- **Version Control:** Git

---

## 📊 Data Flow Summary

```
Customer (WhatsApp)
    ↓
Messaging Gateway (receive message)
    ↓
Routing Service (detect intent with AI)
    ↓
┌─────────────┼─────────────┐
│             │             │
Chatbot       Lead Manager  Appointment
Builder                     Service
│             │             │
└─────────────┼─────────────┘
              ↓
Notification Service (email/SMS)
              ↓
Agent Dashboard (real-time update)
```

---

## 📋 Quick Checklist for Getting Started

### Prerequisites
- [ ] Install Bun
- [ ] Install Node.js
- [ ] Install Docker
- [ ] Install Git
- [ ] Install VS Code

### Setup
- [ ] Clone repository
- [ ] Read README.md
- [ ] Read SETUP_GUIDE.md
- [ ] Get Google Gemini API key
- [ ] Get Telegram Bot Token (easier than WhatsApp)
- [ ] Setup each service's .env file
- [ ] Run each service: `bun run dev`
- [ ] Test health endpoints
- [ ] Test with dummy data

### Team Organization
- [ ] Create WhatsApp/Discord group
- [ ] Assign services to each member
- [ ] Setup GitHub repository
- [ ] Create branch strategy
- [ ] Schedule weekly meetings
- [ ] Read TEAM_GUIDE.md

---

## 🚀 Quick Start Commands

### Setup All Services
```bash
# Messaging Gateway
cd messaging-gateway && bun install && bun run dev

# Routing Service
cd routing-service && bun install && bun run dev

# Lead Manager
cd lead-manager && bun install && bun run dev

# Chatbot Builder
cd chatbot-builder && bun install && bun run dev

# Notification Service
cd notification-service && bun install && bun run dev

# Appointment Service
cd appointment-service && bun install && bun run dev

# Web Dashboard
cd web-dashboard && npm install && npm run dev
```

### Or Use Docker Compose (Easier!)
```bash
cd deployment
docker-compose up -d
```

---

## 📍 Service Ports

| Service | Port | URL |
|---------|------|-----|
| Messaging Gateway | 3000 | http://localhost:3000 |
| Routing Service | 3001 | http://localhost:3001 |
| Lead Manager | 3002 | http://localhost:3002 |
| Chatbot Builder | 3003 | http://localhost:3003 |
| Notification Service | 3004 | http://localhost:3004 |
| Appointment Service | 3005 | http://localhost:3005 |
| Web Dashboard | 5173 | http://localhost:5173 |

---

## 🎓 Learning Path

### For Backend Developers (Members 1 & 2)
1. TypeScript basics
2. Bun runtime
3. Elysia.js framework
4. SQLite + Drizzle ORM
5. REST API design
6. WebSocket programming
7. Google Gemini AI API

### For Frontend Developer (Member 3)
1. Vue 3 Composition API
2. Pinia state management
3. Vue Router
4. Vite build tool
5. WebSocket client
6. Chart.js for analytics
7. Responsive CSS

### For Everyone
1. Git & GitHub workflow
2. Microservices architecture
3. API design & documentation
4. Testing strategies
5. Team collaboration
6. Docker basics

---

## 🤝 Team Communication

### Daily (15 min)
- Standup: What did you do? What will you do? Any blockers?

### Weekly (1 hour)
- Team meeting: Demo progress, plan next week, discuss issues

### As Needed
- WhatsApp/Discord for quick questions
- GitHub Issues for bug tracking
- Pull Requests for code review

---

## 📅 Timeline (8 Weeks)

| Week | Focus | Deliverable |
|------|-------|-------------|
| 1-2 | Setup & Planning | Environment ready, basic structure |
| 3-4 | Core Features | Services working independently |
| 5-6 | Integration | End-to-end flow working |
| 7-8 | Polish & Demo | Bug fixes, presentation ready |

---

## ✅ Success Criteria

By the end of the project, you should have:

1. **Working Demo:**
   - Customer sends message on WhatsApp/Telegram
   - AI detects intent and routes correctly
   - Chatbot responds or escalates to agent
   - Lead is created and scored
   - Agent can see and reply from dashboard
   - Appointment can be scheduled
   - Notifications are sent

2. **Clean Code:**
   - Well-structured
   - TypeScript types
   - Comments where needed
   - Following conventions

3. **Documentation:**
   - All README files complete
   - API documented
   - Setup instructions clear

4. **Team Collaboration:**
   - Git workflow followed
   - Code reviews done
   - Good communication

5. **Presentation:**
   - Working demo
   - Clear explanation
   - Confident delivery

---

## 🆘 Need Help?

### Check These First
1. README.md - Project overview
2. SETUP_GUIDE.md - Setup issues
3. API_DOCUMENTATION.md - API questions
4. ARCHITECTURE.md - System design questions
5. TEAM_GUIDE.md - Collaboration questions

### Still Stuck?
1. Ask your teammates
2. Check GitHub Issues
3. Google the error
4. Ask your mentor/professor

---

## 🎉 You're Ready!

You have:
- ✅ Complete documentation
- ✅ Clean folder structure
- ✅ Clear architecture
- ✅ API specifications
- ✅ Setup guide
- ✅ Team collaboration guide
- ✅ 8-week timeline

**Now it's time to build something amazing!**

---

## 📞 Team Info

**Fill this in:**

**Member 1 (Messaging & Routing):**
- Name: ________________
- Email: ________________
- Phone: ________________

**Member 2 (Leads & Chatbot):**
- Name: ________________
- Email: ________________
- Phone: ________________

**Member 3 (Frontend & Services):**
- Name: ________________
- Email: ________________
- Phone: ________________

**Mentor:**
- Name: ________________
- Email: ________________

**Group Chat:**
- Platform: WhatsApp / Discord / Slack
- Link: ________________

---

**Good luck with your semester project!** 🚀

*Remember: Communication is key, help each other, and have fun building!*
