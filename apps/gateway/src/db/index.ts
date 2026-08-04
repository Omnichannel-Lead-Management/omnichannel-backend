import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { sql } from "drizzle-orm";

// Postgres connection string. Heroku Postgres injects this as DATABASE_URL
// automatically once the add-on is provisioned (both locally via `heroku local`
// and on the deployed dyno).
const connectionString =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/messaging";

// Optional: isolate a test/smoke run into its own schema instead of `public`.
const schemaName = process.env.DATABASE_SCHEMA?.trim();

// Heroku Postgres requires SSL; local/dev Postgres usually doesn't have it configured.
// Default to requiring SSL only in production unless DATABASE_SSL overrides it.
const useSsl = process.env.DATABASE_SSL
  ? process.env.DATABASE_SSL === "true"
  : process.env.NODE_ENV === "production";

const sqlClient = postgres(connectionString, {
  ssl: useSsl ? "require" : false,
  ...(schemaName ? { connection: { search_path: schemaName } } : {})
});

// Initialize Drizzle ORM
export const db = drizzle(sqlClient, { schema });

/**
 * Initialize database tables
 * Creates tables if they don't exist
 */
export async function initDatabase() {
  console.log("🔧 Initializing database...");

  if (schemaName) {
    await sqlClient`CREATE SCHEMA IF NOT EXISTS ${sqlClient(schemaName)}`;
  }

  // Create businesses table (one row per registered vendor/tenant)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      sector TEXT NOT NULL,
      owner_email TEXT,
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

  // Create messengers table with unique constraint
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

  // Create chat_messages table with index for faster queries
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

  // Create whatsapp_message_throttle table for outbound notification throttling
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS whatsapp_message_throttle (
      id SERIAL PRIMARY KEY,
      recipient TEXT NOT NULL UNIQUE,
      last_sent_at TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    )
  `);

  // Add the owner-editable profile columns to pre-existing DBs
  await db.execute(sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS timezone TEXT`);
  await db.execute(sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS contact_phone TEXT`);
  await db.execute(sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS address TEXT`);
  await db.execute(sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS description TEXT`);
  await db.execute(sql`ALTER TABLE businesses ADD COLUMN IF NOT EXISTS business_hours TEXT`);

  // Add escalation columns to existing DBs safely (Postgres supports IF NOT EXISTS directly)
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS is_escalated INTEGER DEFAULT 0`);
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS escalation_status TEXT DEFAULT 'none'`);
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS claimed_by_agent_id TEXT`);
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS claimed_at TEXT`);
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS escalation_requested_at TEXT`);
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS released_at TEXT`);
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS escalation_tag TEXT`);
  await db.execute(sql`ALTER TABLE messengers ADD COLUMN IF NOT EXISTS escalation_summary TEXT`);

  // Add business_id to pre-existing single-tenant DBs and migrate the unique constraint
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

  // Create index for faster history queries
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

  console.log("✅ Database initialized successfully");
}

// Export schema for use in queries
export { schema };
