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
