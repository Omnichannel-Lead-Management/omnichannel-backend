/**
 * Invoice email, end to end through the pieces that actually run in production.
 *
 * These exist because the first version of this feature passed every test and
 * still never sent an invoice: the TypeScript template union had been widened
 * but the SQLite CHECK constraint behind `createEmailDelivery` had not, so the
 * insert threw and the endpoint answered "Email delivery could not be
 * recorded". Nothing typed the gap, so only a test that really writes a row
 * can close it.
 */

import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { initializeDatabase } from "../db";
import {
  createEmailDelivery,
  EMAIL_DELIVERY_TEMPLATES,
  listEmailDeliveries
} from "../email-delivery-store";
import { renderEmailTemplate, type InvoiceIssuedTemplateData } from "../email/templates";

function freshDb(): Database {
  const db = new Database(":memory:");
  initializeDatabase(db);
  return db;
}

const INVOICE: InvoiceIssuedTemplateData = {
  invoice_number: "INV-2026-0001",
  business_name: "Aura Beauty Studio",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  currency: "LKR",
  total: 3500,
  due_date: "2026-10-15",
  line_items: [
    { description: "Standard plan", quantity: 1, amount: 2500 },
    { description: "AI requests — 750 used, 500 included", quantity: 250, amount: 1000 }
  ]
};

describe("the delivery table accepts every template we can render", () => {
  test("each declared template can actually be stored", () => {
    const db = freshDb();

    // The regression in one line: a template the type system allows must also
    // survive the CHECK constraint.
    for (const template of EMAIL_DELIVERY_TEMPLATES) {
      expect(() =>
        createEmailDelivery(db, {
          business_id: "biz_1",
          recipient_email: "owner@example.test",
          template,
          payload: { any: "shape" }
        })
      ).not.toThrow();
    }

    expect(listEmailDeliveries(db, { business_id: "biz_1" })).toHaveLength(
      EMAIL_DELIVERY_TEMPLATES.length
    );
  });

  test("invoice_issued specifically round-trips with its payload intact", () => {
    const db = freshDb();

    const created = createEmailDelivery(db, {
      business_id: "biz_1",
      recipient_email: "owner@example.test",
      template: "invoice_issued",
      payload: INVOICE
    });

    expect(created.template).toBe("invoice_issued");
    expect(created.status).toBe("pending");
    expect(created.payload).toMatchObject({ invoice_number: "INV-2026-0001", total: 3500 });
  });

  test("a template outside the list is still rejected", () => {
    const db = freshDb();

    expect(() =>
      createEmailDelivery(db, {
        business_id: "biz_1",
        recipient_email: "owner@example.test",
        template: "not_a_template" as (typeof EMAIL_DELIVERY_TEMPLATES)[number],
        payload: {}
      })
    ).toThrow();
  });
});

describe("migrating a database created before invoice_issued existed", () => {
  test("widens the constraint and keeps the existing delivery records", () => {
    const db = new Database(":memory:");

    // The exact shape production had: the old two-template CHECK.
    db.exec(`
      CREATE TABLE email_deliveries (
        id TEXT PRIMARY KEY,
        business_id TEXT NOT NULL,
        recipient_email TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'email' CHECK (channel = 'email'),
        template TEXT NOT NULL CHECK (template IN ('new_lead', 'appointment_confirmed')),
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
        provider_message_id TEXT,
        failure_reason TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT
      )
    `);
    db.exec(`
      INSERT INTO email_deliveries (
        id, business_id, recipient_email, channel, template, payload, status,
        attempt_count, created_at, updated_at
      ) VALUES (
        'eml_old', 'biz_1', 'owner@example.test', 'email', 'new_lead', '{"lead_id":"l1"}',
        'sent', 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'
      )
    `);

    initializeDatabase(db);

    // The audit trail survived the rebuild…
    const preserved = listEmailDeliveries(db, { business_id: "biz_1" });
    expect(preserved).toHaveLength(1);
    expect(preserved[0]!.id).toBe("eml_old");
    expect(preserved[0]!.status).toBe("sent");
    expect(preserved[0]!.attempt_count).toBe(1);

    // …and the table now takes the template it used to refuse.
    expect(() =>
      createEmailDelivery(db, {
        business_id: "biz_1",
        recipient_email: "owner@example.test",
        template: "invoice_issued",
        payload: INVOICE
      })
    ).not.toThrow();
  });

  test("running initialize twice is harmless", () => {
    const db = freshDb();
    expect(() => initializeDatabase(db)).not.toThrow();

    createEmailDelivery(db, {
      business_id: "biz_1",
      recipient_email: "owner@example.test",
      template: "invoice_issued",
      payload: INVOICE
    });
    expect(listEmailDeliveries(db, { business_id: "biz_1" })).toHaveLength(1);
  });
});

describe("the rendered invoice email", () => {
  test("states the amount due and itemises what produced it", () => {
    const rendered = renderEmailTemplate({ template: "invoice_issued", data: INVOICE });

    expect(rendered.subject).toContain("INV-2026-0001");
    for (const body of [rendered.text, rendered.html]) {
      expect(body).toContain("LKR 3500.00");
      expect(body).toContain("Standard plan");
      expect(body).toContain("Aura Beauty Studio");
      expect(body).toContain("2026-10-15");
    }
  });

  test("an invoice with no line items still renders the total", () => {
    const rendered = renderEmailTemplate({
      template: "invoice_issued",
      data: { ...INVOICE, line_items: [], due_date: null }
    });

    expect(rendered.text).toContain("LKR 3500.00");
    expect(rendered.html).toContain("LKR 3500.00");
  });

  test("a hostile business name cannot inject markup into the HTML", () => {
    const rendered = renderEmailTemplate({
      template: "invoice_issued",
      data: { ...INVOICE, business_name: '<script>alert("x")</script>' }
    });

    expect(rendered.html).not.toContain("<script>");
    expect(rendered.html).toContain("&lt;script&gt;");
  });
});
