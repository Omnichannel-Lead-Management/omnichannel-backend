# Evolution API — Self-Hosted WhatsApp Gateway

Self-hosted, open-source WhatsApp integration ([evolution-api](https://github.com/EvolutionAPI/evolution-api)) using the WhatsApp Web multi-device protocol (Baileys) instead of the official Meta Cloud API. No Meta Business verification, no per-vendor Meta App — each vendor just scans a QR code.

## Why this instead of Meta Cloud API

| | Meta Cloud API (current `apps/gateway` adapter) | Evolution API |
|---|---|---|
| Per-vendor setup | Vendor creates their own Meta App, gets approved, pastes token | Vendor scans a QR code from their phone — done in seconds |
| Multi-tenant | Not modeled — one shared token today | Native: one "instance" per vendor/business |
| Approval delay | Can be slow (Meta review) | None |
| **Risk** | Official, sanctioned | **Unofficial protocol — WhatsApp can detect and ban numbers doing this, especially at volume. Fine for a course demo; do not rely on it for a paying vendor's only number without telling them the risk.** |

## How multi-tenancy maps here

One Evolution API deployment hosts many **instances** (`POST /instance/create` with a unique `instanceName`). The natural mapping for this project: **one instance per `business_id`** — e.g. instance name `biz_a1b2c3`. Each instance gets its own QR code / WhatsApp session, independent of the others.

## Run it

```bash
cd evolution-api
cp .env.example .env
# edit .env: set POSTGRES_PASSWORD and AUTHENTICATION_API_KEY to real random values

docker compose up -d
docker compose ps
```

API: `http://localhost:8080` (every call needs header `apikey: <AUTHENTICATION_API_KEY>`)

Health check:
```bash
curl http://localhost:8080 -H "apikey: <AUTHENTICATION_API_KEY>"
# {"status":200,"message":"Welcome to the Evolution API, it is working!", ...}
```

### Web Manager UI is bundled — no separate container needed

Open `http://localhost:8080/manager` in a browser (log in with your `AUTHENTICATION_API_KEY`) to create instances and scan QR codes visually.

(There's also a standalone `evoapicloud/evolution-manager` image some guides run as a separate container — deliberately **not used here**: its `:latest` tag has an unresolved upstream nginx crash-loop bug, [EvolutionAPI/evolution-api#2093](https://github.com/EvolutionAPI/evolution-api/issues/2093). No need for it anyway since the bundled `/manager` UI above already works.)

Everything the UI does is also a plain REST call, useful for scripting vendor onboarding instead of clicking through the UI each time:

**Create an instance (one per vendor, name it after their `business_id`):**
```bash
curl -X POST http://localhost:8080/instance/create \
  -H "apikey: <AUTHENTICATION_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"instanceName": "biz_a1b2c3", "qrcode": true, "integration": "WHATSAPP-BAILEYS"}'
```
The response's `qrcode.base64` is a `data:image/png;base64,...` URI — paste it into a browser address bar to render the QR, then scan it from the vendor's WhatsApp app (Linked Devices).

**Re-fetch the QR later** (e.g. it expired before they scanned it) without recreating the instance:
```bash
curl http://localhost:8080/instance/connect/biz_a1b2c3 -H "apikey: <AUTHENTICATION_API_KEY>"
```

**List all instances / check connection status:**
```bash
curl http://localhost:8080/instance/fetchInstances -H "apikey: <AUTHENTICATION_API_KEY>"
```

**Remove a vendor's instance:**
```bash
curl -X DELETE http://localhost:8080/instance/delete/biz_a1b2c3 -H "apikey: <AUTHENTICATION_API_KEY>"
```

If #2093 gets fixed upstream and you want the UI back, add an `evolution-manager` service back to `docker-compose.yml` pointing at a fixed tag once one exists.

## Wired into `apps/gateway`

The gateway drives this automatically — you normally do **not** create instances by
hand. `BusinessRegistry.connectWhatsAppEvolution()` does all three steps:

1. `POST /instance/create` with `instanceName = business_id`.
2. `POST /webhook/set/:instance` pointing at `${PUBLIC_BASE_URL}/webhook/evolution/:business_id`
   (per-instance, not the `WEBHOOK_GLOBAL_*` env vars — those apply to every instance).
3. Outbound sends go through `EvolutionAdapter` → `POST /message/sendText/:instance`.

The instance name and token are stored on the business row, and the QR comes back
from the connect endpoint for the vendor to scan.

### Deployment

Deployed by `deployment/deploy.sh` as a **separate compose project**, but only if
`evolution-api/.env` exists on the host — that file holds the master API key and is
never synced by CI. A host without it just skips this stack.

`evolution-api` joins the core stack's network (`omnichannel-core_default`) as well
as its own, so the gateway reaches it at `http://evolution-api:8080`. Its postgres
and redis stay private to `evolution-net`.

Two values must line up by hand on the host:

| File | Key |
|---|---|
| `evolution-api/.env` | `AUTHENTICATION_API_KEY` — the master key |
| `deployment/.env` | `EVOLUTION_API_KEY` — must be the **same** string |

Also set `SERVER_URL` in `evolution-api/.env` to the address the container is
actually reachable at (not `localhost`) — it is used in generated media links.

Without `EVOLUTION_API_KEY` the gateway's WhatsApp connect endpoints throw
"EVOLUTION_API_KEY is not configured"; nothing else is affected.
