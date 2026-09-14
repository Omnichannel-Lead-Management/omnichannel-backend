# Lead Manager
**Port:** 3002

Lead lifecycle management and scoring service.

## Overview
Manages customer leads, scoring algorithm, agent assignment, and status tracking.

## Documentation
See [Platform Docs](../../docs/) for complete setup.

## Lead notifications

After a lead is persisted, a best-effort background task looks up
`GET ${GATEWAY_SERVICE_URL}/api/businesses/:id` using the persisted business ID.
`GATEWAY_SERVICE_URL` defaults to `http://localhost:3000`; Compose uses
`http://gateway:3000`. The nested `business.id` must match and `business.name`
and `business.owner_email` must be valid before email is requested.

New leads send one POST to `${NOTIFICATION_SERVICE_URL}/api/notifications/email`
with the existing legacy fields plus `template: "new_lead"`, `recipient_email`,
and template `data`. Notification stores one in-app alert and attempts one owner
email. Missing/invalid profiles or failed Gateway lookups fall back to one legacy
request, preserving the alert. Escalations remain in-app only; a new chat lead
still produces a new-lead alert and a separate escalation alert.

Gateway lookup has a four-second deadline; new-lead Notification requests allow
15 seconds, exceeding the SMTP provider's ten-second deadline. Escalations retain
their four-second deadline. Neither task blocks lead creation or chat responses.
There are no retries or post-dispatch fallbacks: a timeout or failed email response
may already have stored the alert, so resending could duplicate it. Process exits
or unavailable services can still lose notifications; no durable outbox exists.

Configure `NOTIFICATIONS_ENABLED=true` and `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
`SMTP_PASS`, `SMTP_FROM` in Notification to enable email. Disabling email there
preserves valid new-lead alerts even when SMTP is unavailable. In Lead Manager,
`NOTIFICATIONS_ENABLED=false` or `NODE_ENV=test` disables all notification calls.

## Quick Start
```bash
bun install
cp .env.example .env
bun run dev
```
