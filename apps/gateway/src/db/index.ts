import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { sql } from "drizzle-orm";

const connectionString =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/messaging";

const schemaName = process.env.DATABASE_SCHEMA?.trim();

const useSsl = process.env.DATABASE_SSL
  ? process.env.DATABASE_SSL === "true"
  : process.env.NODE_ENV === "production";

const sqlClient = postgres(connectionString, {
  ssl: useSsl ? "require" : false,
  ...(schemaName ? { connection: { search_path: schemaName } } : {})
});

export const db = drizzle(sqlClient, { schema });

/** Create the database tables and indexes if they do not exist. */
export async function initDatabase() {
  console.log("🔧 Initializing database...");

  if (schemaName) {
    await sqlClient`CREATE SCHEMA IF NOT EXISTS ${sqlClient(schemaName)}`;
  }

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sector TEXT NOT NULL,
      owner_email TEXT,
      owner_name TEXT,
      chatbot_enabled INTEGER DEFAULT 1,
      timezone TEXT,
      contact_phone TEXT,
      address TEXT,
      description TEXT,
      business_hours TEXT,
      telegram_bot_token TEXT,
      telegram_bot_username TEXT,
      telegram_webhook_secret TEXT,
      whatsapp_instance_name TEXT,
      whatsapp_instance_token TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS messengers (
      id SERIAL PRIMARY KEY,
      messenger_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      business_id TEXT NOT NULL DEFAULT 'biz_default',
      first_name TEXT,
      last_name TEXT,
      username TEXT,
      phone TEXT,
      preferred_language TEXT DEFAULT 'en',
      linked_user_id TEXT,
      metadata TEXT,
      is_escalated INTEGER DEFAULT 0,
      escalation_status TEXT DEFAULT 'none',
      claimed_by_agent_id TEXT,
      claimed_at TEXT,
      escalation_requested_at TEXT,
      released_at TEXT,
      escalation_tag TEXT,
      escalation_summary TEXT,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(messenger_id, platform, business_id)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      messenger_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      business_id TEXT NOT NULL DEFAULT 'biz_default',
      message_text TEXT NOT NULL,
      is_from_user BOOLEAN NOT NULL,
      metadata TEXT,
      created_at TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS whatsapp_message_throttle (
      id SERIAL PRIMARY KEY,
      recipient TEXT NOT NULL UNIQUE,
      last_sent_at TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS platform_admins (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS usage_events (
      id SERIAL PRIMARY KEY,
      business_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      units INTEGER NOT NULL DEFAULT 1,
      model TEXT,
      metadata TEXT,
      occurred_at TEXT NOT NULL,
      created_at TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pricing_plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      currency TEXT NOT NULL DEFAULT 'LKR',
      monthly_fee DOUBLE PRECISION NOT NULL DEFAULT 0,
      included_ai_requests INTEGER NOT NULL DEFAULT 0,
      price_per_ai_request DOUBLE PRECISION NOT NULL DEFAULT 0,
      included_conversations INTEGER NOT NULL DEFAULT 0,
      price_per_conversation DOUBLE PRECISION NOT NULL DEFAULT 0,
      included_messages INTEGER NOT NULL DEFAULT 0,
      price_per_message DOUBLE PRECISION NOT NULL DEFAULT 0,
      tax_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL UNIQUE,
      business_id TEXT NOT NULL,
      pricing_plan_id TEXT,
      plan_name TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      currency TEXT NOT NULL DEFAULT 'LKR',
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      subtotal DOUBLE PRECISION NOT NULL DEFAULT 0,
      tax_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
      tax DOUBLE PRECISION NOT NULL DEFAULT 0,
      total DOUBLE PRECISION NOT NULL DEFAULT 0,
      notes TEXT,
      usage_json TEXT,
      issued_at TEXT,
      due_date TEXT,
      sent_at TEXT,
      send_error TEXT,
      paid_at TEXT,
      voided_at TEXT,
      created_by TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS invoice_line_items (
      id SERIAL PRIMARY KEY,
      invoice_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      description TEXT NOT NULL,
      quantity DOUBLE PRECISION NOT NULL DEFAULT 0,
      unit_price DOUBLE PRECISION NOT NULL DEFAULT 0,
      amount DOUBLE PRECISION NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.execute(sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS owner_name TEXT`);
  await db.execute(sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS timezone TEXT`);
  await db.execute(sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS contact_phone TEXT`);
  await db.execute(sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS address TEXT`);
  await db.execute(sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS description TEXT`);
  await db.execute(sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_hours TEXT`);
  await db.execute(sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS password_hash TEXT`);
  await db.execute(sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS pricing_plan_id TEXT`);
  await db.execute(sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS billing_active INTEGER DEFAULT 1`);

  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS is_escalated INTEGER DEFAULT 0`);
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS escalation_status TEXT DEFAULT 'none'`);
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS claimed_by_agent_id TEXT`);
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS claimed_at TEXT`);
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS escalation_requested_at TEXT`);
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS released_at TEXT`);
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS escalation_tag TEXT`);
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS escalation_summary TEXT`);

  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS business_id TEXT NOT NULL DEFAULT 'biz_default'`);
  await db.execute(sql`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS business_id TEXT NOT NULL DEFAULT 'biz_default'`);
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE messengers DROP CONSTRAINT IF EXISTS messengers_messenger_id_platform_key;
      ALTER TABLE messengers ADD CONSTRAINT messengers_messenger_id_platform_business_id_key
        UNIQUE (messenger_id, platform, business_id);
    EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL;
    END $$;
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_messenger
    ON chat_messages(messenger_id, platform, created_at DESC)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_business
    ON chat_messages(business_id, created_at DESC)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_messengers_escalation
    ON messengers(is_escalated, escalation_status, updated_at DESC)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_messengers_business
    ON messengers(business_id, platform)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_whatsapp_throttle_recipient
    ON whatsapp_message_throttle(recipient)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_usage_events_business
    ON usage_events(business_id, occurred_at)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_invoices_business
    ON invoices(business_id, period_start)
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice
    ON invoice_line_items(invoice_id)
  `);

  await ensureDefaultPricingPlan();

  console.log("✅ Database initialized successfully");
}

/**
 * Every tenant has to be billable on day one, so the platform ships with one
 * rate card. Inserted only when no plan exists at all — never re-seeded, so an
 * admin who edited the prices does not get them reset by a restart.
 */
async function ensureDefaultPricingPlan(): Promise<void> {
  const existing = await db.execute(sql`SELECT 1 FROM pricing_plans LIMIT 1`);
  if (existing.length > 0) return;

  const now = new Date().toISOString();
  await db.execute(sql`
    INSERT INTO pricing_plans (
      id, name, description, currency, monthly_fee,
      included_ai_requests, price_per_ai_request,
      included_conversations, price_per_conversation,
      included_messages, price_per_message,
      tax_percent, is_default, archived, created_at, updated_at
    ) VALUES (
      'plan_standard', 'Standard', 'Default rate card applied to new tenants.',
      ${process.env.ANALYTICS_CURRENCY ?? "LKR"}, 2500,
      500, 4,
      100, 25,
      2000, 0.5,
      0, 1, 0, ${now}, ${now}
    )
  `);
  console.log("💳 Seeded the default pricing plan");
}

export { schema };
