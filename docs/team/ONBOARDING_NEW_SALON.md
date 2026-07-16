# New Salon Onboarding — Registration & Channel Bots

How a **new salon** joins the platform, gets a **Telegram bot**, gets a **WhatsApp bot**, who builds each part, and how the **current skeleton** supports this for the semester project.

---

## 1. Big picture

```
Salon owner
   │
   ├─1─ Registers business on Web Dashboard
   │         → creates business_id (tenant)
   │
   ├─2─ Creates Telegram bot (BotFather) → pastes token into Dashboard
   │         → Gateway stores token + sets webhook
   │
   ├─3─ (Optional / later) Connects WhatsApp Business API
   │         → pastes Phone Number ID + token
   │         → Gateway stores credentials
   │
   └─4─ System attaches default chatbot template (salon sector)
             → customers can message the bot → leads appear in inbox
```

Every salon is a **tenant** (`business_id`). Messages, leads, appointments, and chatbot flows are filtered by that id so Salon A never sees Salon B’s data.

---

## 2. Who builds which part?

| Step | What | Owner | Repo / service |
|------|------|-------|----------------|
| Business registration UI | Sign-up / “Add business” form | **PATHIRANA** | `web-dashboard` |
| Business record API | Create/read business profile | **PATHIRANA** (API) + shared schema, or **PANKAJA** if stored in gateway DB | Prefer gateway `businesses` table |
| Telegram bot creation | Owner uses BotFather (manual) | **Salon owner** (outside code) | — |
| Save Telegram token + set webhook | Store token, call Telegram `setWebhook` | **PANKAJA** | `apps/gateway` |
| WhatsApp Business connect | Meta app + paste credentials | Owner + **PANKAJA** adapter | `apps/gateway` |
| WhatsApp settings UI | Form to paste WA credentials | **PATHIRANA** | `web-dashboard` |
| Default salon chatbot template | Attach pricing/hours flow to new business | **PADMASIRI** | `chatbot-builder` |
| Lead inbox for that salon | Leads scoped by `business_id` | **PADMASIRI** + **PATHIRANA** UI | lead-manager + dashboard |
| Demo seeding (one salon) | Seed `biz_salon_demo` for evaluations | **All** (one person runs script) | gateway / docs |

---

## 3. How a new salon registers (product flow)

### Target flow (what we design for)

1. Owner opens **Web Dashboard** → **Sign up / Register business**.
2. Fills:
   - Business name (e.g. “Elegant Salon”)
   - Sector: `salon` | `tutor` | `photography`
   - Owner name, email, password
   - Optional: phone, city
3. System creates:
   - `business_id` (e.g. `biz_a1b2c3`)
   - Owner user as `role: owner`
   - Empty agent seat (owner can act as agent)
4. Dashboard shows **Connect channels** checklist:
   - [ ] Telegram
   - [ ] WhatsApp (optional)
   - [ ] Chatbot template (auto-applied for sector)

### Semester MVP (what we actually implement first)

Full multi-tenant SaaS signup is heavy. For the course demo we use a **simplified path**:

| Mode | How registration works |
|------|-------------------------|
| **Demo mode (default)** | Team seeds one business in DB / env: `Elegant Salon`, `business_id=biz_001`, sector=`salon` |
| **Semi-real mode** | Dashboard “Settings → Business” form creates a row in `businesses` table (no payment, no email verify) |
| **Full SaaS (out of scope)** | Email verify, plans, billing |

**Recommendation:** Implement **semi-real mode** (simple register + settings) if time allows; always keep **seeded demo salon** for mid/final evaluation.

---

## 4. How the salon gets a Telegram bot

Telegram does **not** give bots automatically. The **salon owner** creates the bot; **our platform** connects it.

### Owner steps (manual — document this in UI help text)

1. Open Telegram → talk to [@BotFather](https://t.me/BotFather)
2. Send `/newbot`
3. Name: e.g. `Elegant Salon Support`
4. Username: e.g. `ElegantSalonSupportBot` (must end with `bot`)
5. BotFather returns a **token**: `123456789:AAF...`
6. Owner copies token into our Dashboard → **Settings → Telegram → Paste token → Connect**

### What our system does next (PANKAJA — Gateway)

```
Dashboard POST /api/businesses/:id/channels/telegram
  { "bot_token": "123456789:AAF..." }
        ↓
Gateway
  1. Saves token encrypted/plain in businesses.telegram_bot_token
  2. Calls Telegram setWebhook:
     https://api.telegram.org/bot<TOKEN>/setWebhook
     { "url": "https://<our-domain>/webhook/telegram/<business_id>" }
     OR single webhook + secret token that maps bot → business
  3. Returns { ok: true, bot_username: "ElegantSalonSupportBot" }
```

### How incoming messages find the salon

| Approach | How it works | Semester choice |
|----------|--------------|-----------------|
| **A. Path per business** | Webhook URL includes `business_id` | Clear, good for demo |
| **B. One webhook + look up token** | Map `bot_id` / secret header → business | Cleaner for many salons |

**Skeleton today:** Gateway uses **one** `TELEGRAM_BOT_TOKEN` in `.env` (single-tenant demo).  

**Upgrade (PANKAJA):** Move token into `businesses` table; resolve `business_id` on each webhook.

### Dev webhook (ngrok)

While developing:

```bash
ngrok http 3000
# set webhook to https://xxxx.ngrok.io/webhook/telegram
```

Script exists: `omnichannel-backend/deployment/register-telegram-webhook.sh`  
Guide: `apps/gateway/examples/telegram-setup.md`

---

## 5. How the salon gets a WhatsApp bot

WhatsApp is **harder** than Telegram. There is no BotFather-style 2-minute setup.

### Reality (Meta WhatsApp Cloud API)

1. Owner needs a **Meta / Facebook Business** account  
2. Create a **WhatsApp Business App** in [Meta Developers](https://developers.facebook.com/)  
3. Get:
   - Temporary or permanent **Access Token**
   - **Phone Number ID**
   - **WhatsApp Business Account ID**
   - **Verify token** (string we choose for webhook verify)
4. Paste these into Dashboard → **Settings → WhatsApp**  
5. Gateway registers Meta webhook callback URL and stores credentials per business  

### Owner-facing steps (help text in UI)

1. Go to Meta Developer Console → Create App → Add WhatsApp product  
2. Add a test number (or real number after business verification)  
3. Copy Phone Number ID + token  
4. Paste into our platform  
5. Click **Verify webhook** (Meta sends a challenge; Gateway answers)

### Who implements what

| Task | Owner |
|------|--------|
| WhatsApp settings form | **PATHIRANA** |
| Store WA credentials on business | **PANKAJA** |
| Webhook verify + inbound/outbound adapter | **PANKAJA** |
| Demo decision | Team: **Telegram first**; WhatsApp = stretch if Meta approval is slow |

### Semester strategy

| Priority | Channel |
|----------|---------|
| **Must have for demos** | Telegram |
| **Should try** | WhatsApp Cloud API test number (one shared Meta app for the team) |
| **Do not block project on** | Real salon phone number verification |

For demos, one **team Meta test number** mapped to `biz_001` is enough.

---

## 6. How the skeleton works today vs target

### Today (current code skeleton)

```
.env
  TELEGRAM_BOT_TOKEN=...     ← one bot for whole system
  WHATSAPP_TOKEN=...         ← optional one WhatsApp

Gateway
  /webhook/telegram          ← all messages
  messengers + chat_messages ← NO business_id column yet in current schema

Routing → Chatbot / Lead / Appointment
```

So the skeleton is **single-tenant demo-ready**: one salon, one Telegram bot, one inbox.

### Target (multi-salon)

```
businesses
  id, name, sector, chatbot_enabled,
  telegram_bot_token, telegram_bot_username,
  whatsapp_phone_number_id, whatsapp_token, whatsapp_verify_token,
  created_at

messengers / chat_messages / leads / appointments
  all include business_id
```

Webhook → resolve business → attach `business_id` → routing → chatbot flow for that business’s sector.

### Migration path (do in order)

1. **PANKAJA:** Add `businesses` table + `business_id` on messengers/messages  
2. **PATHIRANA:** Register / settings UI writing to that API  
3. **PADMASIRI:** On business create (sector=`salon`) → clone default salon flow into `chatbot_flows` for that `business_id`  
4. Keep seeded `biz_001` for demos so evaluation never depends on live signup  

---

## 7. End-to-end sequence (new salon)

```
1. PATHIRANA — Owner submits Register form
2. Gateway/API — INSERT businesses (sector=salon)
3. PADMASIRI — Auto-provision salon chatbot template for business_id
4. PATHIRANA — Show "Connect Telegram" instructions + token field
5. Owner — Creates bot in BotFather, pastes token
6. PANKAJA — Save token, setWebhook(ngrok or server URL)
7. Customer — Opens Telegram, messages @ElegantSalonSupportBot
8. Gateway — Resolves business_id, saves message
9. Routing — Intent → chatbot
10. PADMASIRI — Flow replies with pricing
11. PADMASIRI — Lead created for business_id
12. PATHIRANA — Lead appears in dashboard; optional email via notification service
```

---

## 8. Minimal data model for onboarding

```sql
-- Gateway DB (PANKAJA owns schema)
CREATE TABLE businesses (
  id TEXT PRIMARY KEY,                 -- biz_001
  name TEXT NOT NULL,                  -- Elegant Salon
  sector TEXT NOT NULL,                -- salon | tutor | photography
  owner_email TEXT,
  chatbot_enabled INTEGER DEFAULT 1,
  telegram_bot_token TEXT,
  telegram_bot_username TEXT,
  whatsapp_phone_number_id TEXT,
  whatsapp_token TEXT,
  whatsapp_verify_token TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE business_users (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'owner',           -- owner | agent
  FOREIGN KEY (business_id) REFERENCES businesses(id)
);
```

Auth for dashboard (PATHIRANA): simple JWT after login is enough for the course.

---

## 9. Checklist by member

### PATHIRANA

- [ ] Register / login pages (MVP)
- [ ] Settings: business profile (name, sector)
- [ ] Settings: paste Telegram token → call gateway API
- [ ] Settings: paste WhatsApp credentials (UI even if WA is stretch)
- [ ] Help text / screenshots for BotFather steps
- [ ] After login, show only this `business_id` data

### PANKAJA

- [ ] `businesses` table + APIs to save channel credentials
- [ ] Telegram webhook resolves `business_id`
- [ ] `setWebhook` helper (script + API)
- [ ] WhatsApp webhook verify + adapter (stretch)
- [ ] Pass `business_id` into routing payload

### PADMASIRI

- [ ] Hook: new business with sector `salon` → copy default salon flows
- [ ] All flows/leads filtered by `business_id`
- [ ] Chatbot disabled flag honored per business

### All (demo day)

- [ ] Seed Elegant Salon + one Telegram bot ready before evaluation
- [ ] Document: “For demo we use pre-registered salon; signup UI shown separately”

---

## 10. What to tell the mentor (30 seconds)

> A new salon registers on the dashboard and gets a `business_id`. They create their own Telegram bot with BotFather and paste the token into Settings; our gateway stores it and sets the webhook. WhatsApp uses Meta Cloud API credentials the same way, but Telegram is our primary demo channel because Meta approval is slow. On registration we attach a salon chatbot template so customers get predictable auto-replies and leads show up in that salon’s inbox.

---

## 11. Related docs

| Doc | Link |
|-----|------|
| PANKAJA tasks | [PANKAJA_GATEWAY_ROUTING.md](./PANKAJA_GATEWAY_ROUTING.md) |
| PADMASIRI tasks | [PADMASIRI_LEAD_CHATBOT.md](./PADMASIRI_LEAD_CHATBOT.md) |
| PATHIRANA tasks | [PATHIRANA_DASHBOARD.md](./PATHIRANA_DASHBOARD.md) |
| Telegram setup example | `omnichannel-backend/apps/gateway/examples/telegram-setup.md` |
| Architecture multi-tenancy | `omnichannel-backend/docs/ARCHITECTURE.md` |
