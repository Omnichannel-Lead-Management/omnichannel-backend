import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { EMAIL_DELIVERY_TEMPLATES } from "./email-delivery-store";

/** Durable record of every event the service is told about. */
export function createDatabase(path = process.env.DATABASE_PATH ?? "./data/notification.db"): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  return db;
}

export function initializeDatabase(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      action_url TEXT,
      metadata TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_notifications_business
    ON notifications(business_id, is_read, created_at DESC)
  `);

  db.exec(emailDeliveriesTableSql("email_deliveries"));
  migrateEmailDeliveryTemplates(db);
  createEmailDeliveryIndexes(db);
}

/**
 * The template allow-list is generated from EMAIL_DELIVERY_TEMPLATES rather
 * than written out here.
 *
 * Adding `invoice_issued` to the TypeScript union once left this CHECK behind,
 * and the result was an invoice that was issued but silently never emailed —
 * the insert failed a constraint nothing in the type system knew about. One
 * source of truth is the only way that stays fixed.
 */
function templateCheckList(): string {
  return EMAIL_DELIVERY_TEMPLATES.map((template) => `'${template}'`).join(", ");
}

function emailDeliveriesTableSql(tableName: string): string {
  return `
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'email'
        CHECK (channel = 'email'),
      template TEXT NOT NULL
        CHECK (template IN (${templateCheckList()})),
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'failed')),
      provider_message_id TEXT,
      failure_reason TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0
        CHECK (attempt_count >= 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT
    )
  `;
}

function createEmailDeliveryIndexes(db: Database): void {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_email_deliveries_business_created
    ON email_deliveries(business_id, created_at DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_email_deliveries_business_status
    ON email_deliveries(business_id, status)
  `);
}

/**
 * SQLite cannot alter a CHECK constraint, so widening the template list on an
 * existing database means rebuilding the table. Runs only when the live schema
 * is missing a template we now support, and copies every existing delivery
 * record across — the delivery log is an audit trail, not a cache.
 */
function migrateEmailDeliveryTemplates(db: Database): void {
  const existing = db
    .query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'email_deliveries'")
    .get() as { sql?: string } | null;

  const currentSql = existing?.sql ?? "";
  if (!currentSql) return;

  const missing = EMAIL_DELIVERY_TEMPLATES.filter(
    (template) => !currentSql.includes(`'${template}'`)
  );
  if (missing.length === 0) return;

  console.log(
    `[notification] widening email_deliveries.template to allow: ${missing.join(", ")}`
  );

  // Indexes belong to the old table and follow it to the grave; they are
  // recreated by the caller once the swap is done.
  db.transaction(() => {
    db.exec("DROP TABLE IF EXISTS email_deliveries_migration");
    db.exec(emailDeliveriesTableSql("email_deliveries_migration"));
    db.exec(`
      INSERT INTO email_deliveries_migration (
        id, business_id, recipient_email, channel, template, payload, status,
        provider_message_id, failure_reason, attempt_count, created_at, updated_at, sent_at
      )
      SELECT id, business_id, recipient_email, channel, template, payload, status,
             provider_message_id, failure_reason, attempt_count, created_at, updated_at, sent_at
      FROM email_deliveries
    `);
    db.exec("DROP TABLE email_deliveries");
    db.exec("ALTER TABLE email_deliveries_migration RENAME TO email_deliveries");
  })();
}
