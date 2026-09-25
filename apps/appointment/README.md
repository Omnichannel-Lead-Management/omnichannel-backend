# Appointment Service
**Port:** 3005

Appointment scheduling and calendar management service.

## Overview
Manages appointment booking, availability checking, reminders, and cancellations.

## Documentation
See [Platform Docs](../../docs/) for complete setup.

## Quick Start
```bash
bun install
cp .env.example .env
bun run dev
```

## Appointment confirmation email

Appointment creation saves `pending` and sends no email. Only a successful
`PATCH /api/appointments/:id/status` transition from `pending` to `confirmed`
attempts `POST /api/notifications/email` with `appointment_confirmed`.
This supersedes the older “booking created” wording. Both services are assigned
to Pathirana D.P.C.N.

The conditional SQLite update returns the persisted appointment before any HTTP
work. Appointment Service reads `GET /api/businesses/:businessId` from Gateway,
checks the returned business ID, and uses its `name` and `owner_email` (the
owner/staff mailbox). There is no customer-email fallback. The template data is
`appointment_id`, `business_name`, `customer_name`, `service`, `start_time`, and
`end_time`; stored UTC timestamps are passed unchanged. Existing API responses
and in-app notification behavior remain unchanged.

Set `GATEWAY_URL=http://localhost:3000` and
`NOTIFICATION_SERVICE_URL=http://localhost:3004` in Appointment Service's `.env`.
Compose uses `http://gateway:3000` and `http://notification:3004` respectively.
Configure the correct business profile's `owner_email` through Gateway. In
Notification Service, set `NOTIFICATIONS_ENABLED=true` and `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` (see its `.env.example`).
SMTP credentials belong only in Notification Service.

Profile requests have a 4-second deadline; email HTTP requests have a 12-second
deadline, allowing overhead beyond Notification Service's 10-second SMTP deadline.
Confirmation waits for this bounded best-effort attempt. Missing recipients and
upstream failures produce safe diagnostics without failing or rolling back the
confirmation. Repeated/concurrent confirmations do not send again. There are no
retries: a timed-out request may still deliver. This integration does not guarantee
delivery after a process crash between committing confirmation and sending email;
there is no queue or recovery mechanism.

Run fake-provider tests from the repository root:
`bun test apps/appointment/src/tests apps/notification/src/tests`.
