# Notification Service
**Port:** 3004

Multi-channel notification service (Email, SMS, Push).

## Overview
Sends notifications via email, SMS, and push notifications with template management.

## Documentation
See [Platform Docs](../../docs/) for complete setup.

## Quick Start
```bash
bun install
cp .env.example .env
bun run dev
```

Appointment emails are triggered on successful pending → confirmed transitions,
not booking creation, and go to the business owner/staff mailbox. See the
[appointment integration setup](../appointment/README.md#appointment-confirmation-email).

Set `DASHBOARD_BASE_URL` to the public dashboard origin to include email buttons.
Lead emails open `/leads/:id`; appointment emails open the verified `/appointments`
list. With no valid origin, buttons are omitted. Set
`BUSINESS_UTC_OFFSET_MINUTES` to the same value as the appointment service so
the displayed local date and time match the booking convention (default UTC).
