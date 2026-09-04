import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createDatabase, initializeDatabase } from "../db";
import {
  DEFAULT_EMAIL_DELIVERY_LIMIT,
  EmailDeliveryDataError,
  MAX_EMAIL_DELIVERY_LIMIT,
  createEmailDelivery,
  getEmailDeliveryById,
  listEmailDeliveries,
  markEmailDeliveryFailed,
  markEmailDeliverySent
} from "../email-delivery-store";
import { createNotification } from "../store";

const businessId = "biz_test";

function pendingInput(overrides: Partial<Parameters<typeof createEmailDelivery>[1]> = {}) {
  return {
    business_id: businessId,
    recipient_email: "owner@example.test",
    template: "new_lead" as const,
    payload: { lead_id: "lead_test", score: 42 },
    ...overrides
  };
}

describe("email delivery store", () => {
  let db: Database;

  beforeEach(() => {
    db = createDatabase(":memory:");
    initializeDatabase(db);
  });

  afterEach(() => {
    db.close();
  });

  test("initialization is additive, creates the table and indexes, and can run twice", () => {
    initializeDatabase(db);

    const objects = db
      .query(
        `SELECT type, name FROM sqlite_master
         WHERE name IN (
           'notifications',
           'email_deliveries',
           'idx_email_deliveries_business_created',
           'idx_email_deliveries_business_status'
         )`
      )
      .all() as Array<{ type: string; name: string }>;

    expect(objects).toContainEqual({
      type: "table",
      name: "notifications"
    });

    expect(objects).toContainEqual({
      type: "table",
      name: "email_deliveries"
    });

    expect(objects).toContainEqual({
      type: "index",
      name: "idx_email_deliveries_business_created"
    });

    expect(objects).toContainEqual({
      type: "index",
      name: "idx_email_deliveries_business_status"
    });
  });

  test("existing in-app notifications continue to work", () => {
    const notification = createNotification(db, {
      business_id: businessId,
      type: "lead",
      title: "New lead"
    });

    expect(notification.business_id).toBe(businessId);
    expect(notification.title).toBe("New lead");
  });

  test("creates complete pending records with unique IDs and round-tripped payloads", () => {
    const first = createEmailDelivery(db, pendingInput());

    const second = createEmailDelivery(
      db,
      pendingInput({
        payload: ["second", { nested: true }]
      })
    );

    expect(first.id).toStartWith("eml_");
    expect(second.id).not.toBe(first.id);

    expect(first).toMatchObject({
      business_id: businessId,
      recipient_email: "owner@example.test",
      channel: "email",
      template: "new_lead",
      payload: {
        lead_id: "lead_test",
        score: 42
      },
      status: "pending",
      provider_message_id: null,
      failure_reason: null,
      attempt_count: 0,
      sent_at: null
    });

    expect(second.payload).toEqual([
      "second",
      {
        nested: true
      }
    ]);

    expect(first.created_at).toBe(first.updated_at);
  });

  test("marks a delivery sent atomically and clears an earlier failure", () => {
    const pending = createEmailDelivery(db, pendingInput());

    const directlySentPending = createEmailDelivery(
      db,
      pendingInput()
    );

    const directlySent = markEmailDeliverySent(db, {
      id: directlySentPending.id,
      business_id: businessId,
      provider_message_id: "provider-direct-123"
    });

    const failed = markEmailDeliveryFailed(db, {
      id: pending.id,
      business_id: businessId,
      failure_reason: "Safe temporary failure"
    });

    const sent = markEmailDeliverySent(db, {
      id: pending.id,
      business_id: businessId,
      provider_message_id: "provider-test-123"
    });

    expect(directlySent?.attempt_count).toBe(1);
    expect(failed?.attempt_count).toBe(1);
    expect(sent).not.toBeNull();

    if (sent === null) {
      throw new Error("Expected the delivery to be marked as sent");
    }

    expect(sent).toMatchObject({
      status: "sent",
      attempt_count: 2,
      provider_message_id: "provider-test-123",
      failure_reason: null
    });

    expect(sent.sent_at).not.toBeNull();

    if (sent.sent_at === null) {
      throw new Error(
        "Expected a sent delivery to have a sent_at timestamp"
      );
    }

    expect(sent.sent_at).toBeString();
    expect(sent.updated_at).toBe(sent.sent_at);
  });

  test("marks a pending delivery failed with only the supplied safe reason", () => {
    const pending = createEmailDelivery(db, pendingInput());

    const failed = markEmailDeliveryFailed(db, {
      id: pending.id,
      business_id: businessId,
      failure_reason: "Delivery temporarily unavailable"
    });

    expect(failed).toMatchObject({
      status: "failed",
      attempt_count: 1,
      provider_message_id: null,
      failure_reason: "Delivery temporarily unavailable",
      sent_at: null
    });
  });

  test("wrong-business reads and updates return null without changing the record", () => {
    const pending = createEmailDelivery(db, pendingInput());

    expect(
      markEmailDeliverySent(db, {
        id: pending.id,
        business_id: "biz_other",
        provider_message_id: "provider-wrong"
      })
    ).toBeNull();

    expect(
      markEmailDeliveryFailed(db, {
        id: pending.id,
        business_id: "biz_other",
        failure_reason: "Wrong tenant"
      })
    ).toBeNull();

    expect(
      getEmailDeliveryById(db, {
        id: pending.id,
        business_id: "biz_other"
      })
    ).toBeNull();

    expect(
      getEmailDeliveryById(db, {
        id: pending.id,
        business_id: businessId
      })
    ).toEqual(pending);
  });

  test("listing is tenant-scoped, status-filtered, parameterized, and newest first", () => {
    const older = createEmailDelivery(
      db,
      pendingInput({
        recipient_email: "'; DROP TABLE notifications; --"
      })
    );

    const newer = createEmailDelivery(
      db,
      pendingInput({
        template: "appointment_confirmed"
      })
    );

    createEmailDelivery(
      db,
      pendingInput({
        business_id: "biz_other"
      })
    );

    markEmailDeliveryFailed(db, {
      id: newer.id,
      business_id: businessId,
      failure_reason: "Safe failure"
    });

    db.query(
      "UPDATE email_deliveries SET created_at = ? WHERE id = ?"
    ).run(
      "2026-01-01T00:00:00.000Z",
      older.id
    );

    db.query(
      "UPDATE email_deliveries SET created_at = ? WHERE id = ?"
    ).run(
      "2026-01-02T00:00:00.000Z",
      newer.id
    );

    const listed = listEmailDeliveries(db, {
      business_id: businessId
    });

    const failed = listEmailDeliveries(db, {
      business_id: businessId,
      status: "failed"
    });

    expect(
      listed.map((delivery) => delivery.id)
    ).toEqual([newer.id, older.id]);

    expect(listed[1]?.recipient_email).toBe(
      "'; DROP TABLE notifications; --"
    );

    expect(failed).toHaveLength(1);
    expect(failed[0]?.id).toBe(newer.id);

    expect(
      db.query(
        "SELECT COUNT(*) AS count FROM notifications"
      ).get()
    ).toEqual({
      count: 0
    });
  });

  test("listing applies default, maximum, and normalized invalid limits", () => {
    const insert = db.prepare(
      `INSERT INTO email_deliveries (
        id,
        business_id,
        recipient_email,
        template,
        payload,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'new_lead', '{}', ?, ?)`
    );

    const timestamp = "2026-01-01T00:00:00.000Z";

    for (
      let index = 0;
      index <= MAX_EMAIL_DELIVERY_LIMIT;
      index += 1
    ) {
      insert.run(
        `eml_bulk_${index}`,
        businessId,
        "bulk@example.test",
        timestamp,
        timestamp
      );
    }

    expect(
      listEmailDeliveries(db, {
        business_id: businessId
      })
    ).toHaveLength(DEFAULT_EMAIL_DELIVERY_LIMIT);

    expect(
      listEmailDeliveries(db, {
        business_id: businessId,
        limit: 10_000
      })
    ).toHaveLength(MAX_EMAIL_DELIVERY_LIMIT);

    expect(
      listEmailDeliveries(db, {
        business_id: businessId,
        limit: Number.NaN
      })
    ).toHaveLength(DEFAULT_EMAIL_DELIVERY_LIMIT);

    expect(
      listEmailDeliveries(db, {
        business_id: businessId,
        limit: 0
      })
    ).toHaveLength(1);
  });

  test("malformed stored JSON raises a controlled data error", () => {
    const timestamp = new Date().toISOString();

    db.query(
      `INSERT INTO email_deliveries (
        id,
        business_id,
        recipient_email,
        template,
        payload,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, 'new_lead', ?, ?, ?)`
    ).run(
      "eml_corrupt",
      businessId,
      "owner@example.test",
      "{not-json",
      timestamp,
      timestamp
    );

    expect(() =>
      getEmailDeliveryById(db, {
        id: "eml_corrupt",
        business_id: businessId
      })
    ).toThrow(EmailDeliveryDataError);

    expect(() =>
      getEmailDeliveryById(db, {
        id: "eml_corrupt",
        business_id: businessId
      })
    ).toThrow(
      "Email delivery eml_corrupt contains malformed payload JSON"
    );
  });

  test("rejects payload values that JSON cannot serialize", () => {
    expect(() =>
      createEmailDelivery(
        db,
        pendingInput({
          payload: undefined
        })
      )
    ).toThrow(EmailDeliveryDataError);
  });
});