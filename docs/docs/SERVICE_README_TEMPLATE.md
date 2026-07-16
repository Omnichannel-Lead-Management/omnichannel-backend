# [Service Name] - Messaging Gateway
## Omnichannel Lead Management Platform

**Part of:** [Omnichannel Lead Management Platform](https://github.com/Omnichannel-Lead-Management/platform-docs)

**Repository:** https://github.com/Omnichannel-Lead-Management/messaging-gateway

**Port:** 3000

---

## Overview

The Messaging Gateway is the central hub for all customer messages across multiple platforms (WhatsApp, Telegram, Instagram, Discord, Web Chat). It receives messages via webhooks, stores history, and routes them to appropriate services.

**Key Responsibilities:**
- Receive messages from multiple platforms
- Store message history in database
- Send responses back to customers
- Manage WebSocket connections for real-time agent updates
- Handle human escalation requests

---

## 📚 Documentation

### Platform Documentation
For overall architecture and setup:
- [Platform Overview](https://github.com/Omnichannel-Lead-Management/platform-docs)
- [System Architecture](https://github.com/Omnichannel-Lead-Management/platform-docs/blob/main/ARCHITECTURE.md)
- [Complete Setup Guide](https://github.com/Omnichannel-Lead-Management/platform-docs/blob/main/SETUP_GUIDE.md)
- [Team Collaboration Guide](https://github.com/Omnichannel-Lead-Management/platform-docs/blob/main/TEAM_GUIDE.md)

### This Service
This README covers service-specific setup and development.

---

## 🚀 Quick Start

### Prerequisites
- Bun >= 1.0.0
- Git
- Platform documentation cloned (for shared types)

### Installation

```bash
# Clone this repository
git clone https://github.com/Omnichannel-Lead-Management/messaging-gateway.git
cd messaging-gateway

# Install dependencies
bun install

# Copy environment variables
cp .env.example .env

# Edit .env with your API keys
nano .env
```

### Environment Variables

```env
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_PATH=../shared/data/messaging.db

# WhatsApp
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_access_token
WHATSAPP_APP_SECRET=your_app_secret
WHATSAPP_VERIFY_TOKEN=your_verify_token

# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token

# Service URLs
ROUTING_SERVICE_URL=http://localhost:3001
LEAD_MANAGER_URL=http://localhost:3002
CHATBOT_URL=http://localhost:3003

# JWT
JWT_SECRET=your_jwt_secret
```

### Run Development Server

```bash
bun run dev
```

Server starts on http://localhost:3000

### Test It's Working

```bash
# Check health endpoint
curl http://localhost:3000/health

# Expected response:
# {"status":"ok","service":"messaging-gateway","uptime":123.45}
```

---

## 📁 Project Structure

```
messaging-gateway/
├── src/
│   ├── controllers/           # Webhook handlers
│   │   ├── whatsapp.controller.ts
│   │   ├── telegram.controller.ts
│   │   ├── discord.controller.ts
│   │   └── web.controller.ts
│   │
│   ├── services/              # Business logic
│   │   ├── whatsapp.adapter.ts
│   │   ├── telegram.adapter.ts
│   │   ├── discord.adapter.ts
│   │   ├── message.service.ts
│   │   ├── messenger.service.ts
│   │   └── websocket.service.ts
│   │
│   ├── models/                # Database schemas
│   │   ├── businesses.model.ts
│   │   ├── messengers.model.ts
│   │   └── messages.model.ts
│   │
│   ├── routes/                # API routes
│   │   ├── webhooks.routes.ts
│   │   ├── chat.routes.ts
│   │   └── websocket.routes.ts
│   │
│   ├── types/                 # TypeScript types
│   │   ├── platform.types.ts
│   │   └── message.types.ts
│   │
│   ├── utils/                 # Utilities
│   │   ├── logger.ts
│   │   ├── signature-verify.ts
│   │   └── correlation-id.ts
│   │
│   ├── config/                # Configuration
│   │   ├── database.ts
│   │   └── platforms.ts
│   │
│   └── index.ts               # Entry point
│
├── tests/                     # Unit tests
│   ├── whatsapp.test.ts
│   ├── telegram.test.ts
│   └── message.test.ts
│
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── Dockerfile
├── .dockerignore
└── README.md (this file)
```

---

## 🔌 API Endpoints

### Webhooks

#### `POST /webhook/whatsapp`
Receive WhatsApp messages

**Request:**
```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "messages": [{
          "from": "1234567890",
          "type": "text",
          "text": { "body": "Hello" }
        }]
      }
    }]
  }]
}
```

**Response:** `200 OK`

---

#### `POST /webhook/telegram`
Receive Telegram messages

**Request:**
```json
{
  "update_id": 123456,
  "message": {
    "from": { "id": 123456, "first_name": "John" },
    "chat": { "id": 123456 },
    "text": "Hello"
  }
}
```

**Response:** `200 OK`

---

### Chat Management

#### `POST /api/chat/send`
Send message to customer

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Request:**
```json
{
  "messengerId": "1234567890",
  "platform": "whatsapp",
  "businessId": "biz_001",
  "message": "Hi! How can I help you?"
}
```

**Response:**
```json
{
  "success": true,
  "messageId": "msg_123",
  "timestamp": 1234567890
}
```

---

#### `GET /api/chat/history/:messengerId`
Get conversation history

**Query Parameters:**
- `platform` (required): whatsapp, telegram, etc.
- `businessId` (required)
- `limit` (optional): Default 50
- `offset` (optional): For pagination

**Response:**
```json
{
  "messages": [
    {
      "id": 1,
      "messageText": "What are your prices?",
      "isFromUser": true,
      "createdAt": 1234567890
    }
  ],
  "total": 25,
  "hasMore": false
}
```

---

### WebSocket

#### `WS /ws`
Real-time bidirectional communication

**Connection:**
```javascript
const ws = new WebSocket('ws://localhost:3000/ws?token=JWT_TOKEN');
```

**Events:**
See [API Documentation](https://github.com/Omnichannel-Lead-Management/platform-docs/blob/main/API_DOCUMENTATION.md#websocket-api) for details.

---

## 🗄️ Database Schema

This service uses SQLite database: `messaging.db`

### Tables

**businesses**
- Stores business/tenant information

**messengers**
- Customer profiles across platforms
- Composite primary key: (messenger_id, platform, business_id)

**chat_messages**
- All messages (customer and bot/agent)

See [Architecture Documentation](https://github.com/Omnichannel-Lead-Management/platform-docs/blob/main/ARCHITECTURE.md#database-schema) for complete schema.

---

## 🧪 Testing

### Run Tests
```bash
bun test
```

### Manual Testing with Webhook

Use ngrok to expose local server:

```bash
# Terminal 1: Start service
bun run dev

# Terminal 2: Expose to internet
ngrok http 3000

# Use ngrok URL as webhook URL in WhatsApp/Telegram settings
# Example: https://abc123.ngrok.io/webhook/whatsapp
```

### Unit Test Example

```typescript
// tests/whatsapp.test.ts
import { describe, it, expect } from 'bun:test';
import { handleWhatsAppWebhook } from '../src/controllers/whatsapp.controller';

describe('WhatsApp Webhook', () => {
  it('should receive and store message', async () => {
    const mockReq = {
      body: { /* webhook payload */ }
    };
    const result = await handleWhatsAppWebhook(mockReq);
    expect(result.status).toBe('received');
  });
});
```

---

## 🐳 Docker

### Build Image
```bash
docker build -t messaging-gateway .
```

### Run Container
```bash
docker run -p 3000:3000 --env-file .env messaging-gateway
```

### Using Docker Compose
See [platform-docs/deployment](https://github.com/Omnichannel-Lead-Management/platform-docs/tree/main/deployment)

---

## 🔄 Integration with Other Services

### Sends Requests To:

**Routing Service** (Port 3001)
- `POST /route` - Classify message intent

**Lead Manager** (Port 3002)
- `POST /api/leads` - Create new lead

**Chatbot Builder** (Port 3003)
- `POST /execute` - Execute chatbot flow

**Appointment Service** (Port 3005)
- `POST /api/appointments` - Schedule appointment

### Receives Requests From:

- External platforms (WhatsApp, Telegram) via webhooks
- Web Dashboard via WebSocket
- Other services for sending messages

---

## 🛠️ Development

### Add New Platform

1. **Create adapter:**
```typescript
// src/services/instagram.adapter.ts
export class InstagramAdapter {
  async sendMessage(to: string, message: string) {
    // Instagram API call
  }
}
```

2. **Create controller:**
```typescript
// src/controllers/instagram.controller.ts
export async function handleInstagramWebhook(req, res) {
  // Handle Instagram webhook
}
```

3. **Add route:**
```typescript
// src/routes/webhooks.routes.ts
app.post('/webhook/instagram', handleInstagramWebhook);
```

---

## 🐛 Troubleshooting

### Webhook not receiving messages
1. Check webhook URL is accessible (use ngrok for local)
2. Verify webhook signature validation
3. Check platform settings

### Messages not sending
1. Check API credentials in `.env`
2. Verify platform adapter is correct
3. Check rate limits

### WebSocket connection issues
1. Verify JWT token is valid
2. Check CORS settings
3. Ensure WebSocket server is running

---

## 📖 Additional Resources

- [Platform Documentation](https://github.com/Omnichannel-Lead-Management/platform-docs)
- [System Architecture](https://github.com/Omnichannel-Lead-Management/platform-docs/blob/main/ARCHITECTURE.md)
- [API Documentation](https://github.com/Omnichannel-Lead-Management/platform-docs/blob/main/API_DOCUMENTATION.md)
- [WhatsApp Business API Docs](https://developers.facebook.com/docs/whatsapp/cloud-api)
- [Telegram Bot API Docs](https://core.telegram.org/bots/api)

---

## 🤝 Contributing

1. Create feature branch: `git checkout -b feature/your-feature`
2. Make changes and test
3. Commit: `git commit -m "feat: add feature"`
4. Push: `git push origin feature/your-feature`
5. Create Pull Request

See [Team Guide](https://github.com/Omnichannel-Lead-Management/platform-docs/blob/main/TEAM_GUIDE.md) for workflow details.

---

## 📝 License

MIT License - Part of Omnichannel Lead Management Platform

---

## 👥 Team

**Owner:** Member 1

**Contributors:**
- [Your Name]
- [Team Member 2]
- [Team Member 3]

**Questions?** Open an issue or check the [platform documentation](https://github.com/Omnichannel-Lead-Management/platform-docs).

---

**Part of the [Omnichannel Lead Management Platform](https://github.com/Omnichannel-Lead-Management)**
