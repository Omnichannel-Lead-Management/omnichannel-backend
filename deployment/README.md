# Omnichannel Lead Management — Deployment

Docker Compose deployment for the whole platform. `docker-compose.yml` here is the
single source of truth: it builds the backend apps from `../apps/*` and the two
sibling repos (`../../chatbot-builder`, `../../web-dashboard`) checked out next to
this one.

## Services

| Service | Port | Built from | Storage |
|---|---|---|---|
| `postgres` | — (internal) | `postgres:16-alpine` | `postgres_data` |
| `gateway` | 3000 | `../apps/gateway` | postgres |
| `routing` | 3001 | `../apps/routing` | — |
| `lead-manager` | 3002 | `../apps/lead-manager` | `lead_data` (SQLite) |
| `chatbot` | 3003 | `../../chatbot-builder` | `chatbot_data` (SQLite) |
| `notification` | 3004 | `../apps/notification` | — |
| `appointment` | 3005 | `../apps/appointment` | `appointment_data` (SQLite) |
| `dashboard` | 5173 → 80 | `../../web-dashboard` | — |
| `edge` | 80 / 443 | `nginx:alpine` | — |

Public traffic goes through `edge` only; the per-service host ports are for
debugging. `notification` stores the in-app notification centre and sends
confirmation email.

## Call graph

```
channel → gateway :3000 → routing :3001 ─┬→ chatbot :3003 ──→ lead-manager :3002
                                         ├→ appointment :3005
                                         └→ lead-manager :3002   (lead_qualification)
                                                    └→ notification :3004 (best-effort)
dashboard :80 ──(via edge)──> gateway :3000
```

`chatbot → lead-manager` and `lead-manager → notification` are both best-effort:
timeout-guarded, never fatal. A lead is still created if notification is down, and
a customer still gets a reply if lead-manager is down.

## Prerequisites

- Docker 24+ and Docker Compose v2
- `deployment/.env` — **not synced by CI**, it lives only on the host. Create it by
  hand on a new machine (see "Environment" below).
- Vertex AI (`aiplatform.googleapis.com`) enabled on the GCP project, with the host
  VM's service account granted `roles/aiplatform.user`. Gemini is reached through
  Vertex AI using the VM's Application Default Credentials — set
  `GOOGLE_CLOUD_PROJECT`; no API key is stored in production.
- TLS: `EDGE_CERT_DIR` must contain `origin.crt` / `origin.key`, kept **outside** the
  synced tree so a deploy's `rsync --delete` cannot remove them. Cloudflare fronts
  `cache.us.kg` and connects to the origin over HTTPS.

## Environment

Keys read by `docker-compose.yml` (all optional unless noted; defaults in parentheses):

```bash
GOOGLE_CLOUD_PROJECT=            # required for Vertex AI
GOOGLE_CLOUD_LOCATION=           # (us-central1)
GCE_METADATA_HOST=               # 169.254.169.254 inside Docker — see note below
GEMINI_API_KEY=                  # local-dev fallback only
GEMINI_MODEL=                    # (gemini-2.5-flash)
LLM_ROUTING_ENABLED=             # (true)
TELEGRAM_BOT_TOKEN=
PUBLIC_BASE_URL=                 # (https://cache.us.kg)
CORS_ALLOWED_ORIGINS=            # (https://cache.us.kg,http://cache.us.kg)
AGENT_AUTH_MODE=                 # (none) agent WebSocket handshake only
AUTH_JWT_SECRET=                 # REQUIRED — signs dashboard sessions
AUTH_SESSION_TTL_HOURS=          # (12)
ADMIN_JWT_SECRET=                # signs platform-admin sessions; unset = console off
ADMIN_SESSION_TTL_HOURS=         # (8)
ANALYTICS_CURRENCY=              # (LKR) currency of the seeded rate card
INTERNAL_SERVICE_TOKEN=          # REQUIRED — sibling services' credential
NOTIFICATIONS_ENABLED=           # (false) email stays off until this is true
SMTP_HOST=                       # required when NOTIFICATIONS_ENABLED=true
SMTP_PORT=
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
DASHBOARD_BUSINESS_ID=           # also the lead-manager DEFAULT_BUSINESS_ID
DASHBOARD_BUSINESS_NAME=
DASHBOARD_BUSINESS_SECTOR=
DASHBOARD_BUSINESS_EMAIL=
DASHBOARD_BUSINESS_PROFILE_UPDATE_ENABLED=  # (true) owners edit their profile in Settings
DASHBOARD_ANALYTICS_ENABLED=     # (true) full reporting from the gateway
DASHBOARD_NOTIFICATION_CENTER_ENABLED=  # (true) the header bell
DASHBOARD_WEB_CHAT_ENABLED=      # (true) the embedded web chat widget
DASHBOARD_IMAGE_ATTACHMENTS_ENABLED=    # (false) needs POCKETBASE_URL on the gateway
LEAD_INTEGRATION_ENABLED=        # (true) chatbot → lead-manager capture
AGENT_POOL=                      # (agent_1,agent_2,agent_3) round-robin assignment
BUSINESS_UTC_OFFSET_MINUTES=     # (0)
BUSINESS_OPEN_HOUR=              # (9)
BUSINESS_CLOSE_HOUR=             # (17)
EDGE_CERT_DIR=                   # (./certs)
```

> **Docker + Vertex AI:** containers need `GCE_METADATA_HOST=169.254.169.254` so
> google-auth-library reaches the GCE metadata server by IP — Docker's resolver may
> not answer `metadata.google.internal`.

## Authentication

`/api/` requires a dashboard session token. The exceptions are `POST /api/auth/login`,
`POST /api/businesses` (self-service registration), `/api/health*`,
`/api/messaging/health`, `/api/messaging/receive`, `/webhook/*` and `/ws/*`.

Two credentials are involved, and both are **required** — generate each with
`openssl rand -hex 32`:

| Variable | Used by | Missing means |
|---|---|---|
| `AUTH_JWT_SECRET` | gateway, to sign owner sessions | gateway refuses to start in production |
| `INTERNAL_SERVICE_TOKEN` | chatbot, lead-manager, appointment → gateway | business lookups 401, so confirmation email loses its recipient |
| `ADMIN_JWT_SECRET` | gateway, to sign platform-admin sessions | `/api/admin/` answers 503; the rest of the gateway is unaffected |

`AGENT_AUTH_MODE` is unrelated: it guards only the agent WebSocket handshake.

### Giving an existing tenant its first password

Businesses registered before authentication existed have no password and cannot
be signed into. Set one from the host:

```bash
cd ~/omnichannel/omnichannel-backend/deployment
printf '%s' 'the-new-password' | docker compose --env-file .env exec -T gateway \
  bun run scripts/set-business-password.ts <business-id-or-owner-email>
```

The owner then signs in at `/login` with their `owner_email` and that password.
New tenants set their own password at `/register`.

## The platform admin console

`/admin` is a second, separate console for the people who run the platform — it
reports usage per tenant and issues invoices. It is **not** a super-user view of
the dashboard:

- Admins live in their own `platform_admins` table, sign in at
  `POST /api/admin/auth/login`, and carry a token signed with `ADMIN_JWT_SECRET`
  under a different issuer than tenant sessions.
- An admin token is refused on every route outside `/api/admin/`, so platform
  staff cannot open a tenant's inbox, leads or notifications. Admin endpoints
  return counts only — no message text passes through them.
- A tenant token is refused on every `/api/admin/` route.

Set `ADMIN_JWT_SECRET` with `openssl rand -hex 32`. Leaving it unset disables the
console rather than opening it.

### Creating the first admin

There is no public admin registration — it would be a hole straight into every
tenant's usage data. The first account is created on the host:

```bash
cd ~/omnichannel/omnichannel-backend/deployment
printf '%s' 'the-password' | docker compose --env-file .env exec -T gateway \
  bun run scripts/create-platform-admin.ts admin@example.com --owner --name "Ops"
```

`--owner` may manage other admins; without it the account is a billing admin.
Re-running for an existing email resets that admin's password. They then sign in
at `/admin/login`.

### Metering and billing

The gateway records one `usage_events` row per AI operation it performs for a
tenant — a chatbot reply, a voice transcription, a photo read. Conversations,
messages and contacts are counted from the existing tables, not logged.

Rate cards live in `pricing_plans`; a tenant is billed on its own plan, or on
the plan flagged `is_default` if it has none. The gateway seeds one "Standard"
plan on first boot and never re-seeds it, so prices an admin edits survive
restarts. Invoices store their own totals, plan name and usage snapshot, so a
later price change cannot rewrite a bill that has already been sent.

Sending an invoice emails it through the notification service **and** publishes
it on the tenant's own `/billing` page. Those two are independent: with
`NOTIFICATIONS_ENABLED=false` (the current default) the email fails, the invoice
is still issued, and the failure reason is stored on the invoice and shown in
the console.

### Deploy order

Turning this on is a breaking change: a dashboard built before this change sends
no token and every request it makes answers 401. Deploy the **backend and the
dashboard together**, and set both secrets in `.env` *before* the first deploy —
they are separate repos with separate CI pipelines, so pushing only one leaves
the site signed out until the other lands.


## Deploying

Normal path is CI: pushing to `main` in any of the three repos runs that repo's
`.github/workflows/deploy.yml`, which rsyncs the tree to the host and runs
`deploy.sh`. On the host, by hand:

```bash
cd ~/omnichannel/omnichannel-backend/deployment
./deploy.sh                       # all services
./deploy.sh gateway routing       # just these
```

`deploy.sh` takes a flock so two deploys can't overlap, runs
`docker compose up -d --build`, then **reloads the edge nginx config** if it passes
`nginx -t`. A failed test aborts the deploy and leaves the running config in place.

## The edge proxy and container IPs

`edge-conf/default.conf` resolves upstreams **at request time**
(`resolver 127.0.0.11` + `proxy_pass http://$gateway`) rather than through an
`upstream` block. This is deliberate. nginx resolves an `upstream` name once at
config load; every later `docker compose up` that recreates `gateway` or `dashboard`
gives it a new container IP, and the edge — which is not recreated on every deploy —
keeps dialling the old address and 502s until someone restarts it by hand. Runtime
resolution makes the edge follow containers across recreates.

The config directory is mounted, not the file, because a deploy's rsync replaces the
config with a new inode and a single-file bind mount would keep serving stale content.

## Checks

```bash
docker compose --env-file .env ps
docker compose --env-file .env logs -f lead-manager

curl -s localhost:3000/api/messaging/health
curl -s localhost:3001/health
curl -s localhost:3002/health
curl -s localhost:3003/health
curl -s localhost:3004/health
curl -s localhost:3005/health
curl -s https://cache.us.kg/          # through Cloudflare + edge

# /api/ now needs a session; health endpoints stay open.
TOKEN=$(curl -s -X POST localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"owner_email":"owner@example.com","password":"..."}' | jq -r .token)
curl -s localhost:3000/api/businesses/<id> -H "Authorization: Bearer $TOKEN"
```

## Stop / reset

```bash
docker compose --env-file .env down       # stop
docker compose --env-file .env down -v    # stop AND destroy all SQLite/postgres volumes
```

## WhatsApp (evolution-api)

`../evolution-api/` is a separate compose project (evolution-api + its own postgres
and redis) that `deploy.sh` brings up **only if `../evolution-api/.env` exists on the
host** — that file holds the master API key and is never synced by CI. Its container
joins this stack's network so the gateway reaches it at `http://evolution-api:8080`.

To enable it on a host: create `../evolution-api/.env` from `.env.example` with a
real `POSTGRES_PASSWORD` and `AUTHENTICATION_API_KEY`, then set the *same* key as
`EVOLUTION_API_KEY` in `deployment/.env`. See `../evolution-api/README.md`.

Note it speaks the unofficial WhatsApp Web protocol (Baileys), which can get numbers
banned — fine for a demo, a real risk to disclose to a vendor relying on their number.

Appointment confirmation email uses the Compose Gateway and Notification Service
URLs. Configure the business profile owner email and enable SMTP delivery; see
[appointment email setup and delivery limitations](../apps/appointment/README.md#appointment-confirmation-email).
