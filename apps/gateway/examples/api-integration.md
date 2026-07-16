# External AI Integration Guide

Guide for integrating your AI system with the Messaging Orchestrator.

## Overview

The orchestrator acts as a pure router between messaging platforms and your AI system. No AI logic exists in the orchestrator.

```
User Message → Platform → Orchestrator → [Save to DB] → Your AI
                              ↓
User ← Platform ← Orchestrator ← [Save to DB] ← Reply from AI
```

## 1. Receiving Messages from Orchestrator

Your AI system should expose an endpoint to receive messages:

### Endpoint Configuration

Set in `.env`:
```env
EXTERNAL_AI_ENDPOINT=http://localhost:3001/api/order-chat
```

### Request Format

The orchestrator sends POST requests with this payload:

```typescript
{
  messenger_id: string;      // e.g., "tg_123456789", "web_abc123"
  platform: string;          // "telegram", "web", "whatsapp"
  message: string;           // Current user message
  language: string;          // "en", "es", etc.
  history: [                 // Last 20 messages (chronological)
    {
      is_from_user: boolean;
      text: string;
      timestamp: string;     // ISO 8601
    }
  ];
  user_info: {
    first_name?: string;
    last_name?: string;
    username?: string;
    phone?: string;
    linked_user_id?: string | null;
  };
}
```

### Example: Node.js/Express Handler

```javascript
app.post('/api/order-chat', async (req, res) => {
  const {
    messenger_id,
    platform,
    message,
    language,
    history,
    user_info
  } = req.body;

  console.log(`Received message from ${platform}:${messenger_id}`);
  console.log(`Message: ${message}`);
  console.log(`History length: ${history.length}`);

  // Process with your AI/business logic
  const reply = await processMessage(message, history, user_info);

  // Send reply back to orchestrator
  await sendReply(messenger_id, platform, reply);

  res.json({ success: true });
});
```

## 2. Sending Replies to Orchestrator

Your AI sends replies back to the orchestrator:

### Endpoint

```
POST http://localhost:3000/api/messaging/reply
```

### Request Format

```typescript
{
  platform: string;           // Same as received
  messenger_id: string;       // Same as received
  reply_text: string;         // Your AI's response
  metadata?: {                // Optional platform-specific data
    // For Telegram: inline keyboards, reply keyboards
    // For Web: buttons, images, etc.
  }
}
```

### Example: Sending Reply

```javascript
async function sendReply(messenger_id, platform, text, metadata = {}) {
  const response = await fetch('http://localhost:3000/api/messaging/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      platform,
      messenger_id,
      reply_text: text,
      metadata
    })
  });

  const result = await response.json();

  if (!result.success) {
    console.error('Failed to send reply:', result.error);
  }

  return result;
}
```

## 3. Complete Example: AI Order System

```javascript
import express from 'express';
import OpenAI from 'openai';

const app = express();
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Receive messages from orchestrator
app.post('/api/order-chat', async (req, res) => {
  try {
    const { messenger_id, platform, message, history, user_info } = req.body;

    // Build context from history
    const messages = history.map(h => ({
      role: h.is_from_user ? 'user' : 'assistant',
      content: h.text
    }));

    // Add current message
    messages.push({
      role: 'user',
      content: message
    });

    // Add system prompt
    messages.unshift({
      role: 'system',
      content: `You are a helpful order assistant.
                User: ${user_info.first_name || 'Customer'}
                Platform: ${platform}`
    });

    // Get AI response
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: messages,
      temperature: 0.7,
      functions: [
        {
          name: 'place_order',
          description: 'Place an order for the customer',
          parameters: {
            type: 'object',
            properties: {
              items: { type: 'array', items: { type: 'string' } },
              quantity: { type: 'number' },
              delivery_address: { type: 'string' }
            }
          }
        }
      ]
    });

    const aiMessage = completion.choices[0].message;
    let replyText = aiMessage.content;
    let metadata = {};

    // Handle function calls
    if (aiMessage.function_call) {
      const args = JSON.parse(aiMessage.function_call.arguments);

      // Process order
      const order = await processOrder(messenger_id, args);

      replyText = `Order #${order.id} placed successfully!
                   Items: ${args.items.join(', ')}
                   Delivery to: ${args.delivery_address}`;

      // Add inline keyboard for Telegram
      if (platform === 'telegram') {
        metadata = {
          inline_keyboard: [
            [
              { text: 'Track Order', callback_data: `track_${order.id}` },
              { text: 'Cancel Order', callback_data: `cancel_${order.id}` }
            ]
          ]
        };
      }
    }

    // Send reply back to orchestrator
    await fetch('http://localhost:3000/api/messaging/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform,
        messenger_id,
        reply_text: replyText,
        metadata
      })
    });

    res.json({ success: true });

  } catch (error) {
    console.error('Error processing message:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

async function processOrder(messenger_id, orderData) {
  // Your order processing logic
  return {
    id: Math.random().toString(36).substr(2, 9),
    ...orderData,
    status: 'pending',
    created_at: new Date().toISOString()
  };
}

app.listen(3001, () => {
  console.log('AI system listening on port 3001');
});
```

## 4. Platform-Specific Metadata

### Telegram

```javascript
// Inline keyboard
metadata: {
  inline_keyboard: [
    [
      { text: "Yes", callback_data: "yes" },
      { text: "No", callback_data: "no" }
    ]
  ]
}

// Reply keyboard
metadata: {
  keyboard: [
    ["Option 1", "Option 2"],
    ["Option 3", "Option 4"]
  ]
}
```

### Web Chat

```javascript
// Custom buttons or data
metadata: {
  buttons: [
    { label: "View Menu", action: "menu" },
    { label: "Track Order", action: "track" }
  ],
  quick_replies: ["Yes", "No", "Maybe"]
}
```

## 5. Error Handling

Always handle errors gracefully:

```javascript
try {
  await sendReply(messenger_id, platform, reply);
} catch (error) {
  console.error('Failed to send reply:', error);

  // Optionally retry
  await retryWithBackoff(() =>
    sendReply(messenger_id, platform, reply)
  );
}
```

## 6. Testing Your Integration

### Test Message Flow

```bash
# 1. Send test message
curl -X POST http://localhost:3000/api/messaging/receive \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "telegram",
    "messenger_id": "tg_123456789",
    "message": "I want to order pizza",
    "first_name": "John",
    "language": "en"
  }'

# 2. Your AI should receive the message at your EXTERNAL_AI_ENDPOINT

# 3. Send reply back
curl -X POST http://localhost:3000/api/messaging/reply \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "telegram",
    "messenger_id": "tg_123456789",
    "reply_text": "Great! What size pizza?"
  }'
```

### Check Message History

```bash
curl "http://localhost:3000/api/messaging/history?messenger_id=tg_123456789&platform=telegram"
```

## 7. Best Practices

1. **Async Processing**: Don't block the orchestrator. Return 200 immediately.
2. **Retry Logic**: Implement retries for failed replies.
3. **Rate Limiting**: Respect platform rate limits.
4. **Context Management**: Use the history array for context.
5. **User State**: Store additional state in your own database.
6. **Logging**: Log all interactions for debugging.
7. **Security**: Validate all incoming requests.

## 8. Monitoring

Track these metrics:

- Message processing latency
- AI response time
- Reply success rate
- Error rates
- User satisfaction

## Support

For issues or questions, check:
- Orchestrator logs: `docker logs messaging-orchestrator`
- Your AI logs
- Network connectivity
- API endpoint configuration
