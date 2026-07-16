# API Documentation
## Omnichannel Lead Management Platform

Complete API reference for all microservices.

---

## Table of Contents
1. [Messaging Gateway API](#messaging-gateway-api-port-3000)
2. [Routing Service API](#routing-service-api-port-3001)
3. [Lead Manager API](#lead-manager-api-port-3002)
4. [Chatbot Builder API](#chatbot-builder-api-port-3003)
5. [Notification Service API](#notification-service-api-port-3004)
6. [Appointment Service API](#appointment-service-api-port-3005)
7. [Common Response Formats](#common-response-formats)
8. [Authentication](#authentication)
9. [Error Handling](#error-handling)

---

## Messaging Gateway API (Port 3000)

Base URL: `http://localhost:3000`

### Webhooks

#### Receive WhatsApp Message
```http
POST /webhook/whatsapp
Content-Type: application/json
X-Hub-Signature-256: sha256=<signature>

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

Response: 200 OK
```

#### Receive Telegram Message
```http
POST /webhook/telegram
Content-Type: application/json

{
  "update_id": 123456,
  "message": {
    "message_id": 1,
    "from": { "id": 123456, "first_name": "John" },
    "chat": { "id": 123456 },
    "text": "Hello"
  }
}

Response: 200 OK
```

---

### Chat Management

#### Send Message
```http
POST /api/chat/send
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "messengerId": "1234567890",
  "platform": "whatsapp",
  "businessId": "biz_001",
  "message": "Hi! How can I help you?"
}

Response: 200 OK
{
  "success": true,
  "messageId": "msg_123",
  "timestamp": 1234567890
}
```

#### Get Chat History
```http
GET /api/chat/history/:messengerId?platform=whatsapp&businessId=biz_001&limit=50
Authorization: Bearer <jwt_token>

Response: 200 OK
{
  "messages": [
    {
      "id": 1,
      "messageText": "What are your prices?",
      "isFromUser": true,
      "createdAt": 1234567890
    },
    {
      "id": 2,
      "messageText": "We offer 3 packages...",
      "isFromUser": false,
      "isFromAgent": false,
      "createdAt": 1234567891
    }
  ],
  "total": 25,
  "hasMore": false
}
```

#### Get Messenger Profile
```http
GET /api/messengers/:messengerId?platform=whatsapp&businessId=biz_001
Authorization: Bearer <jwt_token>

Response: 200 OK
{
  "messengerId": "1234567890",
  "platform": "whatsapp",
  "businessId": "biz_001",
  "firstName": "John",
  "phone": "+1234567890",
  "isEscalated": true,
  "claimedByAgentId": "agent_456"
}
```

---

### WebSocket API

#### Connect
```javascript
ws://localhost:3000/ws?token=<jwt_token>
```

#### Client → Server Events

**Agent Reply:**
```json
{
  "type": "agent_reply",
  "messengerId": "1234567890",
  "platform": "whatsapp",
  "businessId": "biz_001",
  "message": "Hi! I'm Sarah. Happy to help."
}
```

**Claim Lead:**
```json
{
  "type": "claim_lead",
  "leadId": "lead_123",
  "agentId": "agent_456"
}
```

#### Server → Client Events

**New Lead:**
```json
{
  "type": "new_lead",
  "data": {
    "leadId": "lead_123",
    "messengerId": "1234567890",
    "platform": "whatsapp",
    "lastMessage": "What are your prices?",
    "score": 45
  }
}
```

**New Message:**
```json
{
  "type": "new_message",
  "data": {
    "messengerId": "1234567890",
    "platform": "whatsapp",
    "message": "Premium please",
    "timestamp": 1234567890
  }
}
```

---

## Routing Service API (Port 3001)

Base URL: `http://localhost:3001`

### Route Message

```http
POST /route
Content-Type: application/json

{
  "message": "What are your prices?",
  "messengerId": "1234567890",
  "platform": "whatsapp",
  "businessId": "biz_001",
  "conversationHistory": [
    { "text": "Previous message", "isFromUser": true }
  ]
}

Response: 200 OK
{
  "intent": "service_inquiry",
  "confidence": 0.95,
  "language": "en",
  "service": "chatbot-builder",
  "url": "http://chatbot-builder:3003/execute"
}
```

**Possible Intents:**
- `service_inquiry` - Customer asking about services/pricing
- `appointment_booking` - Customer wants to schedule
- `complaint` - Customer has an issue
- `general_question` - General inquiry
- `greeting` - Just saying hello
- `unclear` - Cannot determine intent

---

### Health Check

```http
GET /health

Response: 200 OK
{
  "status": "ok",
  "service": "routing-service",
  "uptime": 123.45
}
```

---

## Lead Manager API (Port 3002)

Base URL: `http://localhost:3002`

### Create Lead

```http
POST /api/leads
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "businessId": "biz_001",
  "messengerId": "1234567890",
  "platform": "whatsapp",
  "source": "whatsapp",
  "initialScore": 30,
  "serviceInterest": "haircut"
}

Response: 201 Created
{
  "id": "lead_123",
  "businessId": "biz_001",
  "messengerId": "1234567890",
  "platform": "whatsapp",
  "status": "new",
  "score": 45,
  "source": "whatsapp",
  "createdAt": 1234567890
}
```

---

### List Leads

```http
GET /api/leads?businessId=biz_001&status=new&limit=50&offset=0
Authorization: Bearer <jwt_token>

Response: 200 OK
{
  "leads": [
    {
      "id": "lead_123",
      "businessId": "biz_001",
      "messengerId": "1234567890",
      "platform": "whatsapp",
      "status": "new",
      "score": 75,
      "assignedAgentId": null,
      "tags": ["hot", "premium_interest"],
      "createdAt": 1234567890
    }
  ],
  "total": 125,
  "page": 1,
  "totalPages": 3
}
```

**Query Parameters:**
- `businessId` (required)
- `status` (optional): new, contacted, qualified, converted, lost
- `assignedAgentId` (optional)
- `minScore` (optional): Filter by minimum score
- `tags` (optional): Comma-separated tags
- `limit` (optional): Default 50
- `offset` (optional): Default 0

---

### Get Lead Details

```http
GET /api/leads/:id
Authorization: Bearer <jwt_token>

Response: 200 OK
{
  "id": "lead_123",
  "businessId": "biz_001",
  "messengerId": "1234567890",
  "platform": "whatsapp",
  "status": "qualified",
  "score": 75,
  "source": "whatsapp",
  "assignedAgentId": "agent_456",
  "tags": ["premium_interest", "hot"],
  "notes": "Interested in premium package",
  "serviceInterest": "premium_haircut",
  "budgetRange": "high",
  "createdAt": 1234567890,
  "lastContactAt": 1234567900,
  "activities": [
    {
      "type": "status_changed",
      "description": "Status changed from 'new' to 'contacted'",
      "performedBy": "agent_456",
      "createdAt": 1234567890
    }
  ]
}
```

---

### Update Lead

```http
PATCH /api/leads/:id
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "status": "contacted",
  "notes": "Customer interested in premium package",
  "tags": ["hot", "premium"]
}

Response: 200 OK
{
  "id": "lead_123",
  "status": "contacted",
  "notes": "Customer interested in premium package",
  "tags": ["hot", "premium"],
  "updatedAt": 1234567890
}
```

---

### Assign Lead to Agent

```http
POST /api/leads/:id/assign
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "agentId": "agent_456"
}

Response: 200 OK
{
  "id": "lead_123",
  "assignedAgentId": "agent_456",
  "status": "contacted"
}
```

---

### Recalculate Lead Score

```http
POST /api/leads/:id/score
Authorization: Bearer <jwt_token>

Response: 200 OK
{
  "id": "lead_123",
  "score": 85,
  "scoreBreakdown": {
    "baseScore": 30,
    "platformBonus": 10,
    "engagementBonus": 25,
    "interestBonus": 20
  }
}
```

---

## Chatbot Builder API (Port 3003)

Base URL: `http://localhost:3003`

### Execute Chatbot Flow

```http
POST /execute
Content-Type: application/json

{
  "message": "What are your prices?",
  "intent": "service_inquiry",
  "businessId": "biz_001",
  "messengerId": "1234567890",
  "sessionId": "session_123"
}

Response: 200 OK
{
  "messages": [
    "We offer 3 packages:",
    "Basic: $30, Standard: $50, Premium: $80",
    "Which one interests you?"
  ],
  "createLead": true,
  "leadScore": 30,
  "sessionId": "session_123",
  "waitingForResponse": true
}
```

---

### Create Chatbot Flow

```http
POST /api/flows
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "businessId": "biz_001",
  "name": "Pricing Inquiry Flow",
  "sector": "salon",
  "triggerIntents": ["service_inquiry", "pricing"],
  "flowJson": {
    "nodes": [
      {
        "id": "node_1",
        "type": "message",
        "content": "We offer 3 packages:",
        "next": "node_2"
      }
    ]
  }
}

Response: 201 Created
{
  "id": "flow_123",
  "businessId": "biz_001",
  "name": "Pricing Inquiry Flow",
  "isActive": true,
  "createdAt": 1234567890
}
```

---

### Get Chatbot Flows

```http
GET /api/flows?businessId=biz_001
Authorization: Bearer <jwt_token>

Response: 200 OK
{
  "flows": [
    {
      "id": "flow_123",
      "name": "Pricing Inquiry Flow",
      "sector": "salon",
      "isActive": true,
      "triggerIntents": ["service_inquiry"]
    }
  ]
}
```

---

### Get Flow Templates

```http
GET /api/flows/templates?sector=salon

Response: 200 OK
{
  "templates": [
    {
      "id": "template_salon_pricing",
      "name": "Salon Pricing Flow",
      "sector": "salon",
      "description": "Handles pricing inquiries for salons",
      "previewNodes": [...]
    }
  ]
}
```

---

## Notification Service API (Port 3004)

Base URL: `http://localhost:3004`

### Send Email

```http
POST /api/notifications/email
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "businessId": "biz_001",
  "to": "agent@business.com",
  "subject": "New Lead Assigned",
  "template": "lead_assigned",
  "data": {
    "leadId": "lead_123",
    "customerName": "John Doe",
    "platform": "whatsapp"
  }
}

Response: 200 OK
{
  "id": "notif_123",
  "type": "email",
  "status": "sent",
  "sentAt": 1234567890
}
```

---

### Send SMS

```http
POST /api/notifications/sms
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "businessId": "biz_001",
  "to": "+1234567890",
  "message": "New lead assigned to you. Check dashboard."
}

Response: 200 OK
{
  "id": "notif_124",
  "type": "sms",
  "status": "sent"
}
```

---

### Check Notification Status

```http
GET /api/notifications/:id/status
Authorization: Bearer <jwt_token>

Response: 200 OK
{
  "id": "notif_123",
  "type": "email",
  "status": "delivered",
  "sentAt": 1234567890,
  "deliveredAt": 1234567895
}
```

**Possible Statuses:**
- `pending` - Queued
- `sent` - Sent to provider
- `delivered` - Confirmed delivered
- `failed` - Failed to send
- `bounced` - Email bounced

---

## Appointment Service API (Port 3005)

Base URL: `http://localhost:3005`

### Create Appointment

```http
POST /api/appointments
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "businessId": "biz_001",
  "leadId": "lead_123",
  "messengerId": "1234567890",
  "customerName": "John Doe",
  "customerPhone": "+1234567890",
  "serviceType": "haircut",
  "date": "2024-04-25",
  "time": "14:00",
  "duration": 60
}

Response: 201 Created
{
  "id": "appt_123",
  "businessId": "biz_001",
  "customerName": "John Doe",
  "date": "2024-04-25",
  "time": "14:00",
  "status": "confirmed",
  "createdAt": 1234567890
}
```

---

### List Appointments

```http
GET /api/appointments?businessId=biz_001&date=2024-04-25
Authorization: Bearer <jwt_token>

Response: 200 OK
{
  "appointments": [
    {
      "id": "appt_123",
      "customerName": "John Doe",
      "serviceType": "haircut",
      "date": "2024-04-25",
      "time": "14:00",
      "status": "confirmed"
    }
  ]
}
```

---

### Check Availability

```http
GET /api/appointments/availability?businessId=biz_001&date=2024-04-25
Authorization: Bearer <jwt_token>

Response: 200 OK
{
  "date": "2024-04-25",
  "availableSlots": [
    { "time": "09:00", "duration": 60 },
    { "time": "10:00", "duration": 60 },
    { "time": "14:00", "duration": 60 },
    { "time": "15:00", "duration": 60 }
  ],
  "bookedSlots": [
    { "time": "11:00", "customerName": "Jane" }
  ]
}
```

---

### Update Appointment

```http
PATCH /api/appointments/:id
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "date": "2024-04-26",
  "time": "15:00",
  "status": "confirmed"
}

Response: 200 OK
{
  "id": "appt_123",
  "date": "2024-04-26",
  "time": "15:00",
  "status": "confirmed"
}
```

---

### Cancel Appointment

```http
DELETE /api/appointments/:id
Authorization: Bearer <jwt_token>

Response: 200 OK
{
  "id": "appt_123",
  "status": "cancelled"
}
```

---

## Common Response Formats

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation successful"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input data",
    "details": {
      "field": "email",
      "issue": "Invalid email format"
    }
  }
}
```

---

## Authentication

### JWT Token

All authenticated endpoints require JWT token in header:

```http
Authorization: Bearer <jwt_token>
```

### Get Token (Login)

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "agent@business.com",
  "password": "password123"
}

Response: 200 OK
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "agent_456",
    "email": "agent@business.com",
    "businessId": "biz_001",
    "role": "agent"
  }
}
```

### Token Payload

```json
{
  "userId": "agent_456",
  "businessId": "biz_001",
  "role": "agent",
  "iat": 1234567890,
  "exp": 1234654290
}
```

**Expiration**: 24 hours

---

## Error Handling

### HTTP Status Codes

- `200 OK` - Success
- `201 Created` - Resource created
- `400 Bad Request` - Invalid input
- `401 Unauthorized` - Missing/invalid auth
- `403 Forbidden` - Insufficient permissions
- `404 Not Found` - Resource not found
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error

### Error Response Example

```json
{
  "success": false,
  "error": {
    "code": "LEAD_NOT_FOUND",
    "message": "Lead with ID 'lead_123' not found",
    "statusCode": 404
  }
}
```

### Common Error Codes

- `VALIDATION_ERROR` - Invalid input data
- `UNAUTHORIZED` - Authentication required
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `INTERNAL_ERROR` - Server error

---

## Rate Limits

| Service | Limit | Window |
|---------|-------|--------|
| Messaging Gateway | 100 requests/minute | Per business |
| Routing Service | 60 requests/minute | Per business (Gemini API limit) |
| Lead Manager | 200 requests/minute | Per agent |
| All Services (WebSocket) | 50 messages/minute | Per connection |

**Rate Limit Headers:**
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1234567890
```

---

## Testing APIs

### Using cURL

```bash
# Create lead
curl -X POST http://localhost:3002/api/leads \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "businessId": "biz_001",
    "messengerId": "1234567890",
    "platform": "whatsapp",
    "source": "whatsapp"
  }'
```

### Using Postman

1. Import collection from `docs/api/postman-collection.json`
2. Set environment variables:
   - `BASE_URL`: http://localhost:3000
   - `JWT_TOKEN`: Your auth token
3. Run requests

---

## API Versioning

Currently using URL versioning:
- `v1` (current): `/api/v1/leads`

Future versions will maintain backward compatibility.

---

## Need More Details?

- Check service-specific README files
- See ARCHITECTURE.md for data flows
- Review code examples in each service's `examples/` directory

---

**Happy coding!** 🚀
