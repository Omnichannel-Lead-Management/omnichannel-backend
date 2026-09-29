import type { Database } from "bun:sqlite";

export const EMAIL_DELIVERY_STATUSES = ["pending", "sent", "failed"] as const;
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];

export const EMAIL_DELIVERY_TEMPLATES = [
  "new_lead",
  "appointment_confirmed",
  "invoice_issued"
] as const;
export type EmailDeliveryTemplate = (typeof EMAIL_DELIVERY_TEMPLATES)[number];

export interface EmailDeliveryRecord {
  id: string;
  business_id: string;
  recipient_email: string;
  channel: "email";
  template: EmailDeliveryTemplate;
  payload: unknown;
  status: EmailDeliveryStatus;
  provider_message_id: string | null;
  failure_reason: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

export interface CreateEmailDeliveryInput {
  business_id: string;
  recipient_email: string;
  template: EmailDeliveryTemplate;
  payload: unknown;
}

export interface MarkEmailDeliverySentInput {
  id: string;
  business_id: string;
  provider_message_id: string;
}

export interface MarkEmailDeliveryFailedInput {
  id: string;
  business_id: string;
  failure_reason: string;
}

export interface GetEmailDeliveryByIdInput {
  id: string;
  business_id: string;
}

export interface ListEmailDeliveriesInput {
  business_id: string;
  status?: EmailDeliveryStatus;
  limit?: number;
}

interface EmailDeliveryRow {
  id: string;
  business_id: string;
  recipient_email: string;
  channel: string;
  template: string;
  payload: string;
  status: string;
  provider_message_id: string | null;
  failure_reason: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
  sent_at: string | null;
}

export class EmailDeliveryDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailDeliveryDataError";
  }
}

export const DEFAULT_EMAIL_DELIVERY_LIMIT = 100;
export const MAX_EMAIL_DELIVERY_LIMIT = 500;

function isEmailDeliveryStatus(value: string): value is EmailDeliveryStatus {
  return EMAIL_DELIVERY_STATUSES.some((status) => status === value);
}

function isEmailDeliveryTemplate(value: string): value is EmailDeliveryTemplate {
  return EMAIL_DELIVERY_TEMPLATES.some((template) => template === value);
}

function mapEmailDeliveryRow(row: EmailDeliveryRow): EmailDeliveryRecord {
  if (row.channel !== "email") {
    throw new EmailDeliveryDataError(`Email delivery ${row.id} has an invalid channel`);
  }
  if (!isEmailDeliveryTemplate(row.template)) {
    throw new EmailDeliveryDataError(`Email delivery ${row.id} has an invalid template`);
  }
  if (!isEmailDeliveryStatus(row.status)) {
    throw new EmailDeliveryDataError(`Email delivery ${row.id} has an invalid status`);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(row.payload) as unknown;
  } catch {
    throw new EmailDeliveryDataError(`Email delivery ${row.id} contains malformed payload JSON`);
  }

  return {
    id: row.id,
    business_id: row.business_id,
    recipient_email: row.recipient_email,
    channel: "email",
    template: row.template,
    payload,
    status: row.status,
    provider_message_id: row.provider_message_id ?? null,
    failure_reason: row.failure_reason ?? null,
    attempt_count: row.attempt_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    sent_at: row.sent_at ?? null
  };
}

function serializePayload(payload: unknown): string {
  try {
    const serialized = JSON.stringify(payload);
    if (serialized === undefined) throw new Error("not JSON serializable");
    return serialized;
  } catch {
    throw new EmailDeliveryDataError("Email delivery payload is not JSON serializable");
  }
}

function normalizedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_EMAIL_DELIVERY_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_EMAIL_DELIVERY_LIMIT);
}

export function getEmailDeliveryById(
  db: Database,
  input: GetEmailDeliveryByIdInput
): EmailDeliveryRecord | null {
  const row = db
    .query("SELECT * FROM email_deliveries WHERE id = ? AND business_id = ?")
    .get(input.id, input.business_id) as EmailDeliveryRow | null;

  return row ? mapEmailDeliveryRow(row) : null;
}

export function createEmailDelivery(
  db: Database,
  input: CreateEmailDeliveryInput
): EmailDeliveryRecord {
  const id = `eml_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const timestamp = new Date().toISOString();

  db.query(
    `INSERT INTO email_deliveries (
      id, business_id, recipient_email, channel, template, payload, status,
      provider_message_id, failure_reason, attempt_count, created_at, updated_at, sent_at
    ) VALUES (?, ?, ?, 'email', ?, ?, 'pending', NULL, NULL, 0, ?, ?, NULL)`
  ).run(
    id,
    input.business_id,
    input.recipient_email,
    input.template,
    serializePayload(input.payload),
    timestamp,
    timestamp
  );

  const delivery = getEmailDeliveryById(db, { id, business_id: input.business_id });
  if (!delivery) throw new EmailDeliveryDataError("Created email delivery could not be retrieved");
  return delivery;
}

export function markEmailDeliverySent(
  db: Database,
  input: MarkEmailDeliverySentInput
): EmailDeliveryRecord | null {
  const timestamp = new Date().toISOString();
  db.query(
    `UPDATE email_deliveries
     SET status = 'sent', attempt_count = attempt_count + 1,
         provider_message_id = ?, failure_reason = NULL, sent_at = ?, updated_at = ?
     WHERE id = ? AND business_id = ?`
  ).run(input.provider_message_id, timestamp, timestamp, input.id, input.business_id);

  return getEmailDeliveryById(db, input);
}

export function markEmailDeliveryFailed(
  db: Database,
  input: MarkEmailDeliveryFailedInput
): EmailDeliveryRecord | null {
  const timestamp = new Date().toISOString();
  db.query(
    `UPDATE email_deliveries
     SET status = 'failed', attempt_count = attempt_count + 1,
         provider_message_id = NULL, failure_reason = ?, sent_at = NULL, updated_at = ?
     WHERE id = ? AND business_id = ?`
  ).run(input.failure_reason, timestamp, input.id, input.business_id);

  return getEmailDeliveryById(db, input);
}

export function listEmailDeliveries(
  db: Database,
  input: ListEmailDeliveriesInput
): EmailDeliveryRecord[] {
  const limit = normalizedLimit(input.limit);
  const rows = input.status
    ? db
        .query(
          `SELECT * FROM email_deliveries
           WHERE business_id = ? AND status = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`
        )
        .all(input.business_id, input.status, limit)
    : db
        .query(
          `SELECT * FROM email_deliveries
           WHERE business_id = ?
           ORDER BY created_at DESC, id DESC
           LIMIT ?`
        )
        .all(input.business_id, limit);

  return (rows as EmailDeliveryRow[]).map(mapEmailDeliveryRow);
}
