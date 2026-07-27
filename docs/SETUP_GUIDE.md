# Setup Guide
## Omnichannel Lead Management Platform

Complete setup instructions for your development environment.

---

## Prerequisites

Install these tools before starting:

### 1. Bun (JavaScript Runtime)
```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Verify installation
bun --version  # Should show v1.0+
```

### 2. Node.js (for Web Dashboard)
```bash
# Download from https://nodejs.org (LTS version)
# Or using nvm:
nvm install --lts
nvm use --lts

# Verify
node --version  # Should show v18+
npm --version
```

### 3. Docker & Docker Compose
```bash
# Install Docker Desktop (recommended for beginners)
# Download from https://www.docker.com/products/docker-desktop

# Verify
docker --version
docker-compose --version
```

### 4. Git
```bash
# Usually pre-installed on Mac/Linux
# Windows: Download from https://git-scm.com

git --version
```

### 5. VS Code (Recommended)
Download from https://code.visualstudio.com

**Recommended Extensions:**
- ESLint
- Prettier
- Vue Language Features (Volar)
- SQLite Viewer

---

## Project Setup

### Step 1: Clone Repository
```bash
git clone <your-repo-url>
cd Omnichannel-Lead-Management
```

### Step 2: Setup Each Microservice

#### Messaging Gateway (Port 3000)
```bash
cd messaging-gateway

# Install dependencies
bun install

# Create environment file
cp .env.example .env

# Edit .env with your API keys
# You'll need:
# - WhatsApp Business API credentials (optional for demo)
# - Telegram Bot Token (easier to get - recommended for demo)
nano .env

# Run database migrations
bun run db:migrate

# Start development server
bun run dev

# Test it's running
curl http://localhost:3000/health
```

#### Routing Service (Port 3001)
```bash
cd ../routing-service

bun install
cp .env.example .env

# Set GOOGLE_CLOUD_PROJECT in .env (Gemini is called through Vertex AI).
# Auth comes from Application Default Credentials — no API key needed:
#   gcloud auth application-default login    (local dev)
#   the VM's attached service account        (on GCP)
nano .env

bun run dev

# Test
curl http://localhost:3001/health
```

#### Lead Manager (Port 3002)
```bash
cd ../lead-manager

bun install
cp .env.example .env
nano .env

bun run db:migrate
bun run dev

curl http://localhost:3002/health
```

#### Chatbot Builder (Port 3003)
```bash
cd ../chatbot-builder

bun install
cp .env.example .env
nano .env

bun run db:migrate
bun run dev

curl http://localhost:3003/health
```

#### Notification Service (Port 3004)
```bash
cd ../notification-service

bun install
cp .env.example .env

# Add SMTP credentials for email
# For demo, you can use Gmail with App Password
nano .env

bun run dev

curl http://localhost:3004/health
```

#### Appointment Service (Port 3005)
```bash
cd ../appointment-service

bun install
cp .env.example .env
nano .env

bun run db:migrate
bun run dev

curl http://localhost:3005/health
```

#### Web Dashboard (Port 5173)
```bash
cd ../web-dashboard

# Web dashboard uses npm instead of bun
npm install

# Create .env file
cp .env.example .env

# Start dev server
npm run dev

# Open browser to http://localhost:5173
```

---

## Quick Setup with Docker Compose (Easier!)

Instead of running each service manually, use Docker Compose:

```bash
cd deployment

# Create .env file with all API keys
cp .env.example .env
nano .env

# Build and start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f messaging-gateway

# Stop all services
docker-compose down
```

**Ports:**
- Messaging Gateway: http://localhost:3000
- Routing Service: http://localhost:3001
- Lead Manager: http://localhost:3002
- Chatbot Builder: http://localhost:3003
- Notification Service: http://localhost:3004
- Appointment Service: http://localhost:3005
- Web Dashboard: http://localhost:5173

---

## API Keys & Credentials

### Google Gemini via Vertex AI (Required for AI)

Gemini is called through **Vertex AI**, authenticated with Application Default
Credentials. There is no API key to manage or rotate.

**On the GCP VM (production):**

1. Enable the API once per project:
   ```bash
   gcloud services enable aiplatform.googleapis.com --project omnichannel-vertex
   ```
2. Give the VM's service account the **Vertex AI User** role
   (`roles/aiplatform.user`) and the `cloud-platform` scope.
3. Set in `.env` — credentials are picked up from the VM automatically:
   ```
   GOOGLE_CLOUD_PROJECT=omnichannel-vertex
   GOOGLE_CLOUD_LOCATION=us-central1
   GEMINI_MODEL=gemini-2.5-flash
   ```

**On a local dev machine:**

```bash
gcloud auth application-default login
gcloud config set project omnichannel-vertex
```
then use the same `.env` values.

**Fallback:** without a GCP project you can still run against the Gemini
Developer API by setting `GEMINI_API_KEY` and leaving `GOOGLE_CLOUD_PROJECT`
unset. Force either backend explicitly with
`GOOGLE_GENAI_USE_VERTEXAI=true|false`.

**Quotas:** Vertex AI quota is per-project and per-region, and is billed to the
GCP project rather than capped at the Developer API free tier.

---

### Telegram Bot (Recommended for Demo)

Easiest platform to get started:

1. Open Telegram
2. Search for `@BotFather`
3. Send `/newbot`
4. Follow instructions:
   - Name your bot: "My Test Bot"
   - Username: "my_test_bot" (must end with 'bot')
5. Copy the token you receive
6. Add to `messaging-gateway/.env`:
   ```
   TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
   ```

**Test your bot:**
```bash
# Start messaging-gateway
cd messaging-gateway
bun run dev

# In another terminal, send test message
curl -X POST http://localhost:3000/webhook/telegram \
  -H "Content-Type: application/json" \
  -d '{
    "update_id": 1,
    "message": {
      "message_id": 1,
      "from": {"id": 123456, "first_name": "Test"},
      "chat": {"id": 123456},
      "text": "Hello"
    }
  }'
```

---

### WhatsApp Business API (Optional)

More complex to set up, recommended for final demo:

1. Go to https://developers.facebook.com
2. Create Meta App
3. Add WhatsApp product
4. Get test phone number and API token
5. Add to `.env`:
   ```
   WHATSAPP_PHONE_NUMBER_ID=your_phone_id
   WHATSAPP_ACCESS_TOKEN=your_token
   ```

**Documentation:**
https://developers.facebook.com/docs/whatsapp/cloud-api/get-started

---

### Email (SMTP for Notifications)

**Option 1: Gmail (Easy for testing)**

1. Enable 2-Factor Authentication on your Google Account
2. Generate App Password:
   - Go to https://myaccount.google.com/security
   - Select "App passwords"
   - Generate password for "Mail"
3. Add to `notification-service/.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=your-email@gmail.com
   SMTP_PASSWORD=your-app-password
   ```

**Option 2: Mailtrap (Free testing)**

1. Sign up at https://mailtrap.io (free)
2. Get SMTP credentials
3. Add to `.env`

**Option 3: SendGrid (Production-ready)**

Free tier: 100 emails/day

---

## Database Setup

SQLite databases are stored in `shared/data/`:

```bash
# Create data directory
mkdir -p shared/data

# Databases will be created automatically on first run:
# - messaging.db
# - leads.db
# - chatbot.db
# - appointments.db
# - notifications.db
```

**View databases:**
Use VS Code extension "SQLite Viewer" or command line:
```bash
sqlite3 shared/data/messaging.db
.schema
.tables
SELECT * FROM businesses;
```

---

## Testing the Setup

### Test 1: Health Checks

All services should respond to `/health`:

```bash
curl http://localhost:3000/health  # Messaging Gateway
curl http://localhost:3001/health  # Routing Service
curl http://localhost:3002/health  # Lead Manager
curl http://localhost:3003/health  # Chatbot Builder
curl http://localhost:3004/health  # Notification Service
curl http://localhost:3005/health  # Appointment Service
```

Expected response:
```json
{
  "status": "ok",
  "service": "messaging-gateway",
  "uptime": 123.45,
  "timestamp": 1234567890
}
```

### Test 2: Create a Business

```bash
# Create test business
curl -X POST http://localhost:3000/api/businesses \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Salon",
    "sector": "salon",
    "chatbot_enabled": true
  }'

# Response: {"id": "biz_abc123", "name": "Test Salon", ...}
```

### Test 3: Send Test Message

```bash
# Simulate incoming message
curl -X POST http://localhost:3000/api/chat/send \
  -H "Content-Type: application/json" \
  -d '{
    "messengerId": "test_customer_1",
    "platform": "web",
    "businessId": "biz_abc123",
    "message": "What are your prices?"
  }'
```

### Test 4: Check Web Dashboard

1. Open http://localhost:5173
2. You should see login page
3. For dev, you might need to create admin user first

---

## Common Issues

### Port Already in Use

```bash
# Check what's using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or change port in .env
PORT=3010
```

### Bun Command Not Found

```bash
# Restart terminal after installing Bun
# Or manually add to PATH:
export PATH="$HOME/.bun/bin:$PATH"

# Add to ~/.bashrc or ~/.zshrc for persistence
```

### SQLite Database Locked

```bash
# Close all connections
# Restart the service
# If persists, delete and recreate:
rm shared/data/messaging.db
bun run db:migrate
```

### Vertex AI Quota Exceeded / 403 Permission Denied

**429 quota exceeded** — Vertex AI quota is per-project *and* per-region.

- Wait, or request a quota increase for `aiplatform.googleapis.com` in the console
- Implement request throttling

**403 permission denied** — the service account is missing access.

```bash
# Confirm the API is on
gcloud services list --enabled --project omnichannel-vertex | grep aiplatform
# Grant Vertex AI User to the VM's service account
gcloud projects add-iam-policy-binding omnichannel-vertex \
  --member "serviceAccount:<SA_EMAIL>" --role roles/aiplatform.user
```

**"Could not load the default credentials"** — ADC is not available. On a VM,
check the instance has the `cloud-platform` scope; locally run
`gcloud auth application-default login`. Inside Docker, set
`GCE_METADATA_HOST=169.254.169.254` so the container reaches the metadata
server without a DNS lookup.
- Upgrade to paid tier

### CORS Errors in Web Dashboard

Add to backend `.env`:
```
CORS_ALLOWED_ORIGINS=http://localhost:5173
```

---

## Development Workflow

### Daily Workflow

1. **Start all services:**
   ```bash
   docker-compose up -d
   # OR manually start each service
   ```

2. **Check logs:**
   ```bash
   docker-compose logs -f
   ```

3. **Make changes to code**

4. **Services auto-reload** (hot reload enabled in dev mode)

5. **Test your changes**

6. **Commit to Git:**
   ```bash
   git add .
   git commit -m "Add feature X"
   git push
   ```

### Branch Strategy (for your team)

```bash
# Main branch (protected)
main

# Development branch
develop

# Feature branches (each member)
feature/member1-messaging-gateway
feature/member2-lead-manager
feature/member3-web-dashboard
```

**Workflow:**
1. Create feature branch: `git checkout -b feature/your-name-feature`
2. Make changes and commit
3. Push: `git push origin feature/your-name-feature`
4. Create Pull Request to `develop`
5. Team reviews
6. Merge to `develop`
7. Before demo, merge `develop` to `main`

---

## Team Division - Recommended Setup

### Member 1: Backend Core
**Responsibility**: Messaging Gateway + Routing Service

**Setup:**
```bash
cd messaging-gateway
bun run dev

# In another terminal
cd routing-service
bun run dev
```

**Focus:**
- WhatsApp/Telegram integration
- AI intent classification
- Message routing logic

---

### Member 2: Business Logic
**Responsibility**: Lead Manager + Chatbot Builder

**Setup:**
```bash
cd lead-manager
bun run dev

# In another terminal
cd chatbot-builder
bun run dev
```

**Focus:**
- Lead scoring algorithm
- Chatbot flow execution
- Lead assignment logic

---

### Member 3: Frontend & Notifications
**Responsibility**: Web Dashboard + Notification/Appointment Services

**Setup:**
```bash
cd web-dashboard
npm run dev

# In another terminal
cd notification-service
bun run dev

# In another terminal
cd appointment-service
bun run dev
```

**Focus:**
- Vue.js dashboard UI
- Real-time WebSocket updates
- Email/SMS notifications

---

## Environment Variables Summary

Create `.env` files in each service directory. Here's what each needs:

### All Services (Common)
```env
NODE_ENV=development
DATABASE_PATH=../shared/data/<service-name>.db
```

### Messaging Gateway
```env
PORT=3000
TELEGRAM_BOT_TOKEN=your_token
WHATSAPP_PHONE_NUMBER_ID=your_id
WHATSAPP_ACCESS_TOKEN=your_token
ROUTING_SERVICE_URL=http://localhost:3001
LEAD_MANAGER_URL=http://localhost:3002
```

### Routing Service
```env
PORT=3001
GOOGLE_CLOUD_PROJECT=omnichannel-vertex
GOOGLE_CLOUD_LOCATION=us-central1
GEMINI_MODEL=gemini-2.5-flash
```

### Lead Manager
```env
PORT=3002
NOTIFICATION_SERVICE_URL=http://localhost:3004
```

### Web Dashboard
```env
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000/ws
```

---

## Next Steps

1. ✅ Install prerequisites
2. ✅ Clone repository
3. ✅ Setup services
4. ✅ Get API keys
5. ✅ Test basic functionality
6. 📖 Read `API_DOCUMENTATION.md` for endpoints
7. 📖 Read `TEAM_GUIDE.md` for collaboration
8. 🚀 Start building!

---

## Getting Help

- **Documentation**: Check README.md and ARCHITECTURE.md
- **Service Docs**: Each service has its own README
- **API Reference**: See API_DOCUMENTATION.md
- **Common Errors**: Check this guide's troubleshooting section
- **Team**: Ask your teammates in your group chat!

---

**Setup complete! Time to build something amazing!** 🎉
