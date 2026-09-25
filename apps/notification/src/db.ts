import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

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

  db.exec(`
    CREATE TABLE IF NOT EXISTS email_deliveries (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'email'
        CHECK (channel = 'email'),
      template TEXT NOT NULL
        CHECK (template IN ('new_lead', 'appointment_confirmed')),
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
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_email_deliveries_business_created
    ON email_deliveries(business_id, created_at DESC)
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_email_deliveries_business_status
    ON email_deliveries(business_id, status)
  `);
}
