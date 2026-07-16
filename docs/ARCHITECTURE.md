# System Architecture Documentation
## Omnichannel Lead Management Platform

---

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [System Diagram](#system-diagram)
3. [Data Flow Scenarios](#data-flow-scenarios)
4. [Database Schema](#database-schema)
5. [Service Communication](#service-communication)
6. [Security Architecture](#security-architecture)
7. [Scalability & Performance](#scalability--performance)
8. [Technology Decisions](#technology-decisions)

---

## Architecture Overview

### Design Principles

This platform follows a **microservices architecture** with these core principles:

1. **Service Independence**: Each service can be developed, tested, deployed, and scaled independently
2. **Single Responsibility**: Each service handles one specific domain (messaging, routing, leads, etc.)
3. **Loose Coupling**: Services communicate via REST APIs and WebSocket, not direct database access
4. **Multi-Tenancy**: All services support multiple businesses with complete data isolation
5. **Event-Driven**: Real-time updates use WebSocket for immediate notification
6. **Fault Tolerance**: Circuit breakers and retry logic prevent cascading failures

### Why Microservices?

**Benefits for your project:**
- **Team Collaboration**: 3 team members can work on different services simultaneously
- **Technology Flexibility**: Each service can use different libraries or patterns
- **Easy Testing**: Test each service independently
- **Clear Boundaries**: Each service has well-defined responsibilities
- **Scalability**: Scale only the services that need it

**Trade-offs:**
- More complex than monolithic architecture
- Requires good documentation (which we're providing!)
- Need to handle service-to-service communication
- Distributed data management

---

## System Diagram

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        EXTERNAL WORLD                            │
└─────────────────────────────────────────────────────────────────┘
        │                  │                  │
        │ WhatsApp         │ Telegram         │ Web
        │ Webhook          │ Webhook          │ Browser
        │                  │                  │
        ▼                  ▼                  ▼
┌────────────────────────────────────────────────────────────────────┐
│                                                                     │
│                    MESSAGING GATEWAY (Port 3000)                    │
│                                                                     │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │  Webhook    │  │   Platform   │  │    WebSocket Server      │  │
│  │  Receivers  │  │   Adapters   │  │  (Real-time to agents)   │  │
│  └─────────────┘  └──────────────┘  └──────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │        Message Database (SQLite)                             │  │
│  │  • chat_messages: All customer messages                      │  │
│  │  • messengers: Customer profiles                             │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────┬───────────────────────────────────────────────────────┘
             │
             │ HTTP POST /route
             │ { message, businessId, platform, messengerId }
             │
             ▼
┌────────────────────────────────────────────────────────────────────┐
│                    ROUTING SERVICE (Port 3001)                      │
│                                                                     │
│  ┌──────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
│  │  Google Gemini   │  │ Intent          │  │  Language       │   │
│  │  AI Integration  │  │ Classification  │  │  Detection      │   │
│  └──────────────────┘  └─────────────────┘  └─────────────────┘   │
│                                                                     │
│  Returns: { intent, service, language, confidence }                │
└────────┬───────────────────┬───────────────────┬───────────────────┘
         │                   │                   │
         │ service_inquiry   │ appointment       │ general_question
         ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   CHATBOT       │  │  APPOINTMENT    │  │  LEAD MANAGER   │
│   BUILDER       │  │  SERVICE        │  │  (Port 3002)    │
│   (Port 3003)   │  │  (Port 3005)    │  │                 │
│                 │  │                 │  │  • Lead CRUD    │
│  • Flow Engine  │  │  • Scheduling   │  │  • Scoring      │
│  • Templates    │  │  • Reminders    │  │  • Assignment   │
│  • Execution    │  │  • Calendar     │  │  • Analytics    │
└────────┬────────┘  └────────┬────────┘  └────────┬────────┘
         │                    │                     │
         └────────────────────┼─────────────────────┘
                              │
                              │ Trigger notifications
                              ▼
         ┌───────────────────────────────────────────────┐
         │   NOTIFICATION SERVICE (Port 3004)            │
         │                                                │
         │  ┌───────────┐  ┌───────────┐  ┌──────────┐  │
         │  │   Email   │  │    SMS    │  │   Push   │  │
         │  │  Adapter  │  │  Adapter  │  │  Adapter │  │
         │  └───────────┘  └───────────┘  └──────────┘  │
         └────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND LAYER                                │
│                                                                   │
│                  WEB DASHBOARD (Port 5173)                        │
│                       Vue 3 + Pinia                               │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐     │
│  │    Agent     │  │     Lead     │  │    Analytics       │     │
│  │   Console    │  │  Management  │  │    Dashboard       │     │
│  └──────────────┘  └──────────────┘  └────────────────────┘     │
│                                                                   │
│  WebSocket ←─────────────────────→ Messaging Gateway             │
│  REST APIs ←─────────────────────→ All Services                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     DATA LAYER (SQLite)                          │
│                                                                   │
│  messaging.db    leads.db    chatbot.db    appointments.db       │
│  notifications.db                                                 │
│                                                                   │
│  Stored in: shared/data/                                         │
│  Accessed via: Drizzle ORM (type-safe queries)                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Flow Scenarios

### Scenario 1: Incoming Customer Message (WhatsApp)

**Step-by-step flow when customer sends: "What are your prices?"**

```
1. CUSTOMER ACTION
   └─ Sends WhatsApp message: "What are your prices?"

2. WHATSAPP SERVER
   └─ Calls webhook: POST https://your-domain.com/webhook/whatsapp
      Body: { from: "1234567890", message: "What are your prices?" }

3. MESSAGING GATEWAY (Port 3000)
   └─ Receives webhook at /webhook/whatsapp
   └─ Validates webhook signature (security)
   └─ Extracts: messengerId = "1234567890", platform = "whatsapp"
   └─ Checks database: Is this customer known?
       ├─ If NEW → Create messenger record in database
       └─ If EXISTING → Load existing profile
   └─ Stores message in chat_messages table:
       {
         messenger_id: "1234567890",
         platform: "whatsapp",
         business_id: "biz_001",
         message_text: "What are your prices?",
         is_from_user: true,
         created_at: 1234567890
       }

4. ROUTING SERVICE CALL
   └─ Messaging Gateway → POST http://routing-service:3001/route
      Body: {
        message: "What are your prices?",
        messengerId: "1234567890",
        platform: "whatsapp",
        businessId: "biz_001",
        conversationHistory: [...]
      }

5. ROUTING SERVICE (Port 3001)
   └─ Receives request
   └─ Calls Google Gemini API:
       Prompt: "Classify intent: 'What are your prices?'"
       Possible intents: [service_inquiry, appointment_booking, complaint]
   └─ Gemini responds:
       { intent: "service_inquiry", confidence: 0.95, language: "en" }
   └─ Routing decision:
       if intent == "service_inquiry" → route to CHATBOT BUILDER
   └─ Returns to Messaging Gateway:
       {
         service: "chatbot-builder",
         intent: "service_inquiry",
         url: "http://chatbot-builder:3003/execute"
       }

6. CHATBOT BUILDER (Port 3003)
   └─ Messaging Gateway → POST http://chatbot-builder:3003/execute
      Body: {
        message: "What are your prices?",
        intent: "service_inquiry",
        businessId: "biz_001",
        messengerId: "1234567890"
      }
   └─ Loads chatbot flow for business "biz_001"
   └─ Executes flow nodes:
       Node 1: Check if chatbot enabled → YES
       Node 2: Match intent "service_inquiry" → FOUND
       Node 3: Execute pricing sub-flow:
         - Send message: "We offer 3 packages:"
         - Send message: "Basic: $30, Standard: $50, Premium: $80"
         - Send message: "Which one interests you?"
   └─ Returns response:
       {
         messages: [
           "We offer 3 packages:",
           "Basic: $30, Standard: $50, Premium: $80",
           "Which one interests you?"
         ],
         createLead: true,
         leadScore: 30
       }

7. LEAD MANAGER (Port 3002)
   └─ Messaging Gateway → POST http://lead-manager:3002/api/leads
      Body: {
        businessId: "biz_001",
        messengerId: "1234567890",
        platform: "whatsapp",
        source: "chatbot",
        initialScore: 30
      }
   └─ Creates lead record
   └─ Calculates score:
       + 30 (from chatbot)
       + 10 (WhatsApp source bonus)
       + 5 (first contact within business hours)
       = 45 total score
   └─ Assigns to agent (if auto-assign enabled)
   └─ Triggers notification

8. NOTIFICATION SERVICE (Port 3004)
   └─ Lead Manager → POST http://notification-service:3004/api/notifications/email
      Body: {
        to: "agent@business.com",
        template: "new_lead_assigned",
        data: { leadId: "lead_123", customerPhone: "1234567890" }
      }
   └─ Sends email to agent

9. MESSAGING GATEWAY SENDS RESPONSE
   └─ Uses WhatsApp adapter to send messages back:
       → WhatsApp API: POST https://graph.facebook.com/v17.0/messages
          {
            to: "1234567890",
            type: "text",
            text: { body: "We offer 3 packages:" }
          }
       → WhatsApp API: (repeat for other messages)
   └─ Stores bot responses in chat_messages:
       { message_text: "We offer 3 packages:", is_from_user: false }

10. WEB DASHBOARD REAL-TIME UPDATE
    └─ Messaging Gateway broadcasts via WebSocket:
        Event: "new_lead"
        Data: {
          leadId: "lead_123",
          messengerId: "1234567890",
          platform: "whatsapp",
          lastMessage: "What are your prices?",
          score: 45
        }
    └─ Agent dashboard receives event and updates UI:
        - Show notification
        - Add lead to queue
        - Play alert sound

11. CUSTOMER RECEIVES RESPONSE
    └─ Customer sees 3 messages on WhatsApp
    └─ Can continue conversation
```

**Timeline**: Entire flow takes ~2-3 seconds

---

### Scenario 2: Agent Replies to Customer

**Step-by-step flow when agent sends reply from dashboard**

```
1. AGENT ACTION
   └─ Opens lead in Web Dashboard
   └─ Types message: "Hi! I'm Sarah. Happy to help with pricing."
   └─ Clicks "Send"

2. WEB DASHBOARD (Frontend)
   └─ Captures form submission
   └─ Sends via WebSocket to Messaging Gateway:
       {
         type: "agent_reply",
         messengerId: "1234567890",
         platform: "whatsapp",
         businessId: "biz_001",
         message: "Hi! I'm Sarah. Happy to help with pricing.",
         agentId: "agent_456"
       }

3. MESSAGING GATEWAY (Port 3000)
   └─ Receives WebSocket message
   └─ Validates agent is authorized for this business
   └─ Stores message in chat_messages:
       {
         messenger_id: "1234567890",
         platform: "whatsapp",
         business_id: "biz_001",
         message_text: "Hi! I'm Sarah. Happy to help with pricing.",
         is_from_user: false,
         is_from_agent: true,
         agent_id: "agent_456",
         created_at: 1234567890
       }
   └─ Uses WhatsApp adapter to send:
       → WhatsApp API: POST messages
          { to: "1234567890", text: "Hi! I'm Sarah..." }

4. LEAD MANAGER UPDATE
   └─ Messaging Gateway → PATCH http://lead-manager:3002/api/leads/lead_123
      Body: {
        status: "contacted",
        lastContactAt: 1234567890,
        lastContactBy: "agent_456"
      }
   └─ Lead status updated: new → contacted

5. CUSTOMER RECEIVES MESSAGE
   └─ Customer sees agent's reply on WhatsApp
   └─ Knows they're now talking to a human
```

---

### Scenario 3: Appointment Booking

**Step-by-step flow for scheduling appointment**

```
1. CUSTOMER MESSAGE
   └─ "I'd like to book an appointment for Thursday 2pm"

2. ROUTING SERVICE
   └─ Gemini classifies intent: "appointment_booking"
   └─ Routes to: APPOINTMENT SERVICE

3. APPOINTMENT SERVICE (Port 3005)
   └─ Receives: { message: "Thursday 2pm", businessId: "biz_001" }
   └─ Extracts date/time using NLP or Gemini:
       { date: "2024-04-25", time: "14:00" }
   └─ Checks availability:
       GET http://appointment-service:3005/api/appointments/availability
       Query: ?date=2024-04-25&time=14:00&businessId=biz_001
   └─ If available:
       └─ Creates appointment:
           {
             business_id: "biz_001",
             messenger_id: "1234567890",
             lead_id: "lead_123",
             date: "2024-04-25",
             time: "14:00",
             duration: 60,
             status: "confirmed"
           }
       └─ Schedules reminders:
           - 24 hours before
           - 1 hour before
   └─ If NOT available:
       └─ Suggests alternatives

4. NOTIFICATION SERVICE
   └─ Sends confirmation email to customer
   └─ Sends notification to business owner

5. LEAD MANAGER UPDATE
   └─ Updates lead score: +20 (appointment booked)
   └─ Updates status: contacted → qualified
```

---

## Database Schema

### Multi-Tenant Design

**Every table includes `business_id` for tenant isolation:**

```typescript
// Example: Querying leads for a specific business
const leads = await db.select()
  .from(leadsTable)
  .where(
    and(
      eq(leadsTable.businessId, currentBusinessId), // Tenant isolation
      eq(leadsTable.status, "new")
    )
  );
```

This ensures:
- Business A cannot see Business B's data
- All queries automatically filter by business_id
- Complete data isolation

---

### Database 1: messaging.db (Messaging Gateway)

#### Table: businesses
```sql
CREATE TABLE businesses (
  id TEXT PRIMARY KEY,                      -- Unique business ID (e.g., "biz_001")
  name TEXT NOT NULL,                       -- Business name (e.g., "Salon XYZ")
  sector TEXT NOT NULL,                     -- salon, tutor, photographer, clinic
  plan_type TEXT DEFAULT 'free',            -- free, basic, premium
  chatbot_enabled INTEGER DEFAULT 0,        -- 0 = disabled, 1 = enabled
  max_leads_per_month INTEGER DEFAULT 100,  -- Rate limit
  max_messages_per_day INTEGER DEFAULT 500, -- Rate limit
  whatsapp_phone TEXT,                      -- WhatsApp Business phone number
  whatsapp_api_key TEXT,                    -- API credentials
  telegram_bot_token TEXT,                  -- Telegram bot token
  created_at INTEGER NOT NULL,              -- Unix timestamp
  updated_at INTEGER NOT NULL
);
```

**Example data:**
```json
{
  "id": "biz_001",
  "name": "Elegant Salon & Spa",
  "sector": "salon",
  "plan_type": "premium",
  "chatbot_enabled": 1,
  "whatsapp_phone": "+1234567890",
  "created_at": 1234567890
}
```

---

#### Table: messengers
```sql
CREATE TABLE messengers (
  messenger_id TEXT NOT NULL,               -- Customer ID on platform
  platform TEXT NOT NULL,                   -- whatsapp, telegram, discord, web
  business_id TEXT NOT NULL,                -- FK to businesses
  first_name TEXT,
  last_name TEXT,
  phone TEXT,                               -- For WhatsApp
  username TEXT,                            -- For Telegram/Discord
  preferred_language TEXT DEFAULT 'en',     -- en, es, fr
  is_escalated INTEGER DEFAULT 0,           -- 0 = bot, 1 = escalated to human
  escalation_status TEXT,                   -- pending, claimed, resolved
  claimed_by_agent_id TEXT,                 -- Which agent claimed this
  last_message_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),

  PRIMARY KEY (messenger_id, platform, business_id),
  FOREIGN KEY (business_id) REFERENCES businesses(id)
);
```

**Example data:**
```json
{
  "messenger_id": "1234567890",
  "platform": "whatsapp",
  "business_id": "biz_001",
  "first_name": "John",
  "phone": "+1234567890",
  "preferred_language": "en",
  "is_escalated": 1,
  "claimed_by_agent_id": "agent_456"
}
```

**Why composite primary key?**
- Same person might contact on WhatsApp AND Telegram
- We track them separately per platform
- (messenger_id + platform + business_id) = unique identifier

---

#### Table: chat_messages
```sql
CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  messenger_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  business_id TEXT NOT NULL,
  message_text TEXT NOT NULL,
  is_from_user INTEGER NOT NULL,            -- 1 = customer, 0 = bot/agent
  is_from_agent INTEGER DEFAULT 0,          -- 1 if human agent replied
  agent_id TEXT,                            -- Which agent sent this
  intent TEXT,                              -- detected intent (if from AI)
  metadata TEXT,                            -- JSON: attachments, location, etc.
  created_at INTEGER DEFAULT (unixepoch()),

  FOREIGN KEY (messenger_id, platform, business_id)
    REFERENCES messengers(messenger_id, platform, business_id)
);

CREATE INDEX idx_messages_messenger ON chat_messages(messenger_id, platform, business_id);
CREATE INDEX idx_messages_business ON chat_messages(business_id, created_at);
```

**Example data:**
```json
[
  {
    "id": 1,
    "messenger_id": "1234567890",
    "platform": "whatsapp",
    "business_id": "biz_001",
    "message_text": "What are your prices?",
    "is_from_user": 1,
    "is_from_agent": 0,
    "intent": "service_inquiry",
    "created_at": 1234567890
  },
  {
    "id": 2,
    "messenger_id": "1234567890",
    "platform": "whatsapp",
    "business_id": "biz_001",
    "message_text": "We offer 3 packages: Basic $30...",
    "is_from_user": 0,
    "is_from_agent": 0,
    "created_at": 1234567891
  }
]
```

---

### Database 2: leads.db (Lead Manager)

#### Table: leads
```sql
CREATE TABLE leads (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  messenger_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT DEFAULT 'new',                -- new, contacted, qualified, converted, lost
  score INTEGER DEFAULT 0,                  -- 0-100
  source TEXT NOT NULL,                     -- whatsapp, telegram, web, referral
  channel_source TEXT,                      -- Specific: instagram_ad, google_search
  assigned_agent_id TEXT,
  tags TEXT,                                -- JSON array: ["hot", "premium_interest"]
  notes TEXT,                               -- Agent notes
  service_interest TEXT,                    -- What service they asked about
  budget_range TEXT,                        -- Low, medium, high
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_contact_at INTEGER,
  converted_at INTEGER,                     -- When they became customer
  conversion_value REAL,                    -- Revenue from this lead

  FOREIGN KEY (business_id) REFERENCES businesses(id)
);

CREATE INDEX idx_leads_business ON leads(business_id, status);
CREATE INDEX idx_leads_agent ON leads(assigned_agent_id, status);
CREATE INDEX idx_leads_score ON leads(business_id, score DESC);
```

**Lead Status Lifecycle:**
```
new → contacted → qualified → converted
                             → lost
```

**Example data:**
```json
{
  "id": "lead_123",
  "business_id": "biz_001",
  "messenger_id": "1234567890",
  "platform": "whatsapp",
  "status": "qualified",
  "score": 75,
  "source": "whatsapp",
  "assigned_agent_id": "agent_456",
  "tags": ["premium_interest", "hot"],
  "service_interest": "premium_haircut_package",
  "budget_range": "high",
  "created_at": 1234567890,
  "last_contact_at": 1234567900
}
```

---

#### Table: lead_activities
```sql
CREATE TABLE lead_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,              -- message_sent, status_changed, note_added
  description TEXT NOT NULL,
  performed_by TEXT,                        -- agent_id or "system"
  metadata TEXT,                            -- JSON: old_value, new_value
  created_at INTEGER DEFAULT (unixepoch()),

  FOREIGN KEY (lead_id) REFERENCES leads(id)
);
```

**Purpose**: Track all activities on a lead for audit trail

**Example data:**
```json
[
  {
    "lead_id": "lead_123",
    "activity_type": "status_changed",
    "description": "Status changed from 'new' to 'contacted'",
    "performed_by": "agent_456",
    "metadata": "{\"old_value\": \"new\", \"new_value\": \"contacted\"}",
    "created_at": 1234567890
  },
  {
    "lead_id": "lead_123",
    "activity_type": "note_added",
    "description": "Interested in premium package",
    "performed_by": "agent_456",
    "created_at": 1234567895
  }
]
```

---

### Database 3: chatbot.db (Chatbot Builder)

#### Table: chatbot_flows
```sql
CREATE TABLE chatbot_flows (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,                       -- "Pricing Inquiry Flow"
  sector TEXT NOT NULL,                     -- salon, tutor, photographer
  is_active INTEGER DEFAULT 1,
  is_template INTEGER DEFAULT 0,            -- 1 if it's a reusable template
  flow_json TEXT NOT NULL,                  -- Full flow definition (JSON)
  trigger_intents TEXT,                     -- JSON array: ["service_inquiry", "pricing"]
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  created_by TEXT,                          -- agent_id who created it

  FOREIGN KEY (business_id) REFERENCES businesses(id)
);
```

**Flow JSON Structure:**
```json
{
  "id": "flow_001",
  "name": "Salon Pricing Flow",
  "nodes": [
    {
      "id": "node_1",
      "type": "message",
      "content": "We offer 3 packages:",
      "next": "node_2"
    },
    {
      "id": "node_2",
      "type": "message",
      "content": "Basic: $30, Standard: $50, Premium: $80",
      "next": "node_3"
    },
    {
      "id": "node_3",
      "type": "question",
      "content": "Which package interests you?",
      "wait_for_response": true,
      "next": "node_4"
    },
    {
      "id": "node_4",
      "type": "branch",
      "conditions": [
        { "keyword": "premium", "next": "node_5" },
        { "keyword": "standard", "next": "node_6" },
        { "keyword": "basic", "next": "node_7" },
        { "default": true, "next": "node_8" }
      ]
    },
    {
      "id": "node_5",
      "type": "message",
      "content": "Great choice! Premium includes haircut + styling + hair treatment.",
      "action": "update_lead_score",
      "action_params": { "score_increment": 20 },
      "next": "node_9"
    },
    {
      "id": "node_9",
      "type": "trigger_service",
      "service": "appointment",
      "message": "Would you like to book an appointment?"
    }
  ],
  "variables": {
    "business_name": "Elegant Salon",
    "business_hours": "9 AM - 6 PM"
  }
}
```

---

#### Table: chatbot_sessions
```sql
CREATE TABLE chatbot_sessions (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  messenger_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  current_node_id TEXT,                     -- Where user is in the flow
  session_state TEXT,                       -- JSON: variables, user responses
  started_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  completed INTEGER DEFAULT 0,
  escalated_to_human INTEGER DEFAULT 0,

  FOREIGN KEY (flow_id) REFERENCES chatbot_flows(id)
);
```

**Purpose**: Track active chatbot conversations and resume state

---

### Database 4: appointments.db (Appointment Service)

#### Table: appointments
```sql
CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  messenger_id TEXT,
  lead_id TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  service_type TEXT NOT NULL,               -- haircut, consultation, class
  date TEXT NOT NULL,                       -- YYYY-MM-DD
  time TEXT NOT NULL,                       -- HH:MM
  duration INTEGER DEFAULT 60,              -- minutes
  status TEXT DEFAULT 'confirmed',          -- confirmed, cancelled, completed, no_show
  assigned_agent_id TEXT,                   -- Who's handling this
  location TEXT,
  notes TEXT,
  reminder_sent_24h INTEGER DEFAULT 0,
  reminder_sent_1h INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (business_id) REFERENCES businesses(id),
  FOREIGN KEY (lead_id) REFERENCES leads(id)
);

CREATE INDEX idx_appointments_date ON appointments(business_id, date, time);
CREATE INDEX idx_appointments_status ON appointments(business_id, status);
```

---

#### Table: availability_slots
```sql
CREATE TABLE availability_slots (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  agent_id TEXT,                            -- NULL means business-wide
  day_of_week TEXT NOT NULL,                -- monday, tuesday, etc.
  start_time TEXT NOT NULL,                 -- "09:00"
  end_time TEXT NOT NULL,                   -- "17:00"
  is_available INTEGER DEFAULT 1,
  max_concurrent_appointments INTEGER DEFAULT 1,

  FOREIGN KEY (business_id) REFERENCES businesses(id)
);
```

**Purpose**: Define when business is available for appointments

---

### Database 5: notifications.db (Notification Service)

#### Table: notifications
```sql
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  recipient TEXT NOT NULL,                  -- Email or phone number
  type TEXT NOT NULL,                       -- email, sms, push
  template_id TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'pending',            -- pending, sent, failed, bounced
  sent_at INTEGER,
  failed_reason TEXT,
  metadata TEXT,                            -- JSON: lead_id, appointment_id
  created_at INTEGER NOT NULL,

  FOREIGN KEY (business_id) REFERENCES businesses(id)
);

CREATE INDEX idx_notifications_status ON notifications(business_id, status);
```

---

## Service Communication

### 1. Synchronous Communication (HTTP/REST)

**When to use:**
- CRUD operations
- Request-response patterns
- When you need immediate result

**Example: Lead Manager creates notification**
```typescript
// lead-manager/src/services/lead.service.ts
async function assignLeadToAgent(leadId: string, agentId: string) {
  // Update lead in database
  await db.update(leadsTable)
    .set({ assigned_agent_id: agentId })
    .where(eq(leadsTable.id, leadId));

  // Call Notification Service
  const response = await fetch(`${NOTIFICATION_SERVICE_URL}/api/notifications/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      businessId: lead.businessId,
      to: agent.email,
      template: "lead_assigned",
      data: {
        leadId,
        customerName: lead.customerName,
        platform: lead.platform
      }
    })
  });

  return response.json();
}
```

---

### 2. Asynchronous Communication (WebSocket)

**When to use:**
- Real-time updates
- Push notifications
- Bi-directional communication

**Example: Agent Console receiving updates**
```typescript
// web-dashboard/src/services/websocket.service.ts
class WebSocketService {
  private ws: WebSocket;

  connect() {
    this.ws = new WebSocket('ws://localhost:3000/ws');

    this.ws.addEventListener('message', (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'new_lead':
          queueStore.addLead(data.lead);
          notificationSound.play();
          break;

        case 'new_message':
          messagesStore.addMessage(data.message);
          break;

        case 'lead_updated':
          queueStore.updateLead(data.leadId, data.updates);
          break;
      }
    });
  }

  sendMessage(messengerId: string, message: string) {
    this.ws.send(JSON.stringify({
      type: 'agent_reply',
      messengerId,
      message
    }));
  }
}
```

---

### 3. Service Discovery

**How services find each other:**

**Development:** Use localhost with hardcoded ports
```typescript
// config/services.ts
export const SERVICES = {
  ROUTING: process.env.ROUTING_SERVICE_URL || 'http://localhost:3001',
  LEAD_MANAGER: process.env.LEAD_MANAGER_URL || 'http://localhost:3002',
  CHATBOT: process.env.CHATBOT_URL || 'http://localhost:3003',
  NOTIFICATION: process.env.NOTIFICATION_URL || 'http://localhost:3004',
  APPOINTMENT: process.env.APPOINTMENT_URL || 'http://localhost:3005',
};
```

**Production (Docker Compose):** Use service names
```yaml
# docker-compose.yml
services:
  messaging-gateway:
    environment:
      - ROUTING_SERVICE_URL=http://routing-service:3001
      - LEAD_MANAGER_URL=http://lead-manager:3002
```

---

### 4. Error Handling & Retries

**Circuit Breaker Pattern:**
```typescript
// routing-service/src/utils/circuit-breaker.ts
class CircuitBreaker {
  private failureCount = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private threshold = 5;
  private timeout = 60000; // 1 minute

  async call(fn: () => Promise<any>) {
    if (this.state === 'OPEN') {
      throw new Error('Circuit breaker is OPEN');
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  private onFailure() {
    this.failureCount++;

    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
      setTimeout(() => {
        this.state = 'HALF_OPEN';
      }, this.timeout);
    }
  }
}
```

**Usage:**
```typescript
const geminiCircuitBreaker = new CircuitBreaker();

async function classifyIntent(message: string) {
  try {
    return await geminiCircuitBreaker.call(async () => {
      return await callGeminiAPI(message);
    });
  } catch (error) {
    // Fallback: Use keyword matching
    return keywordBasedClassification(message);
  }
}
```

---

## Security Architecture

### 1. Authentication

**JWT Token Flow:**
```
1. Agent logs in → POST /api/auth/login
   Body: { email, password }

2. Server validates credentials
   └─ Check database: users table
   └─ Verify password hash (bcrypt)

3. Server generates JWT token:
   const token = jwt.sign(
     {
       userId: user.id,
       businessId: user.businessId,
       role: user.role
     },
     JWT_SECRET,
     { expiresIn: '24h' }
   );

4. Client stores token:
   localStorage.setItem('auth_token', token);

5. Subsequent requests include token:
   Authorization: Bearer <token>

6. Server validates token on each request:
   const decoded = jwt.verify(token, JWT_SECRET);
   req.user = decoded; // Attach user info to request
```

---

### 2. Multi-Tenant Data Isolation

**Always filter by business_id:**
```typescript
// ❌ BAD: Exposes all businesses' data
const leads = await db.select().from(leadsTable);

// ✅ GOOD: Only current business data
const leads = await db.select()
  .from(leadsTable)
  .where(eq(leadsTable.businessId, currentBusinessId));
```

**Middleware to enforce:**
```typescript
// middleware/tenant-isolation.ts
export function tenantIsolation(req, res, next) {
  // Extract business ID from JWT token
  const { businessId } = req.user;

  // Attach to request
  req.businessId = businessId;

  // All subsequent database queries MUST use req.businessId
  next();
}
```

---

### 3. Webhook Security

**Verify webhook signatures:**
```typescript
// messaging-gateway/src/controllers/whatsapp.controller.ts
function verifyWhatsAppSignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  const payload = JSON.stringify(req.body);

  const expectedSignature = crypto
    .createHmac('sha256', WHATSAPP_APP_SECRET)
    .update(payload)
    .digest('hex');

  return signature === `sha256=${expectedSignature}`;
}

app.post('/webhook/whatsapp', (req, res) => {
  if (!verifyWhatsAppSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Process webhook
});
```

---

### 4. Rate Limiting

```typescript
// messaging-gateway/src/middleware/rate-limit.ts
const messageRateLimiter = new Map();

function rateLimitMiddleware(req, res, next) {
  const { businessId } = req;
  const now = Date.now();

  if (!messageRateLimiter.has(businessId)) {
    messageRateLimiter.set(businessId, { count: 0, resetAt: now + 60000 });
  }

  const limit = messageRateLimiter.get(businessId);

  if (now > limit.resetAt) {
    // Reset counter
    limit.count = 0;
    limit.resetAt = now + 60000;
  }

  limit.count++;

  // Check against business plan limit
  const maxMessages = getBusinessPlan(businessId).maxMessagesPerMinute;

  if (limit.count > maxMessages) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

  next();
}
```

---

## Scalability & Performance

### Horizontal Scaling

**Each service can run multiple instances:**

```yaml
# docker-compose.yml
version: '3.8'

services:
  messaging-gateway:
    image: messaging-gateway:latest
    deploy:
      replicas: 3  # Run 3 instances
    ports:
      - "3000-3002:3000"
    environment:
      - DATABASE_PATH=/data/messaging.db

  nginx:
    image: nginx:latest
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - messaging-gateway
```

**Load balancer config:**
```nginx
# nginx.conf
upstream messaging_gateway {
  server messaging-gateway-1:3000;
  server messaging-gateway-2:3000;
  server messaging-gateway-3:3000;
}

server {
  listen 80;

  location /webhook/ {
    proxy_pass http://messaging_gateway;
  }
}
```

---

### Database Optimization

**Indexes for common queries:**
```sql
-- Speed up lead lookups
CREATE INDEX idx_leads_business_status ON leads(business_id, status);
CREATE INDEX idx_leads_score ON leads(business_id, score DESC);

-- Speed up message history
CREATE INDEX idx_messages_messenger ON chat_messages(messenger_id, platform, created_at DESC);

-- Speed up appointment lookups
CREATE INDEX idx_appointments_date ON appointments(business_id, date, time);
```

**Query optimization:**
```typescript
// ✅ GOOD: Use indexes
const recentLeads = await db.select()
  .from(leadsTable)
  .where(
    and(
      eq(leadsTable.businessId, businessId),
      eq(leadsTable.status, 'new')
    )
  )
  .orderBy(desc(leadsTable.score))
  .limit(50);

// ❌ BAD: Full table scan
const allLeads = await db.select().from(leadsTable);
const filtered = allLeads.filter(l => l.businessId === businessId);
```

---

### Caching Strategy (Future Enhancement)

```typescript
// Using Redis for caching
import Redis from 'ioredis';

const redis = new Redis();

async function getBusinessSettings(businessId: string) {
  // Check cache first
  const cached = await redis.get(`business:${businessId}`);
  if (cached) {
    return JSON.parse(cached);
  }

  // Not in cache, query database
  const business = await db.select()
    .from(businessesTable)
    .where(eq(businessesTable.id, businessId))
    .limit(1);

  // Store in cache for 1 hour
  await redis.setex(`business:${businessId}`, 3600, JSON.stringify(business));

  return business;
}
```

---

## Technology Decisions

| Component | Technology | Why? | Alternatives Considered |
|-----------|-----------|------|------------------------|
| **Runtime** | Bun | Fast, TypeScript native, built-in SQLite | Node.js (slower), Deno (less mature) |
| **API Framework** | Elysia.js | Lightweight, type-safe, great DX | Express (not type-safe), Fastify (more complex) |
| **Database** | SQLite + Drizzle ORM | Embedded, no setup, type-safe queries | PostgreSQL (overkill for small project), MySQL, MongoDB |
| **Frontend** | Vue 3 | Reactive, great for dashboards, easy to learn | React (more complex), Svelte (less ecosystem) |
| **State Management** | Pinia | Vue 3 native, simple, composable | Vuex (older), Redux (overkill) |
| **AI** | Google Gemini | Cost-effective, good for classification | OpenAI GPT (more expensive), Claude (similar) |
| **Real-time** | WebSocket | Native browser support, low latency | Socket.IO (more features but heavier), SSE (one-way) |
| **Containers** | Docker | Standard, widely used, easy deployment | Podman (less common), bare metal (harder to manage) |

---

## Summary

This architecture provides:

✅ **Clear separation of concerns** - Each service has one job
✅ **Independent development** - 3 team members can work in parallel
✅ **Scalability** - Can handle growth by adding more instances
✅ **Maintainability** - Easy to understand and modify
✅ **Multi-tenancy** - Supports multiple businesses securely
✅ **Real-time capabilities** - Instant updates via WebSocket
✅ **Fault tolerance** - Circuit breakers and retries

---

**Next Steps**: Read `API_DOCUMENTATION.md` to see all available endpoints!
