import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";
import { sql } from "drizzle-orm";

// Database path from environment or default
const dbPath = process.env.DATABASE_PATH || "./sqlite/messaging.db";

// Ensure sqlite directory exists
await Bun.write(`${dbPath}.init`, "");
await Bun.$`rm ${dbPath}.init`.quiet();

// Initialize SQLite database
const sqlite = new Database(dbPath, { create: true });

// Enable foreign keys and WAL mode for better performance
sqlite.exec("PRAGMA foreign_keys = ON");
sqlite.exec("PRAGMA journal_mode = WAL");

// Initialize Drizzle ORM
export const db = drizzle(sqlite, { schema });

/**
 * Initialize database tables
 * Creates tables if they don't exist
 */
export async function initDatabase() {
  console.log("🔧 Initializing database...");

  // Create messengers table with unique constraint
  db.run(sql`
    CREATE TABLE IF NOT EXISTS messengers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      messenger_id TEXT NOT NULL,
      platform TEXT NOT NULL,
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
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(messenger_id, platform)
    )
  `);

  // Create chat_messages table with index for faster queries
  db.run(sql`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      messenger_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      message_text TEXT NOT NULL,
      is_from_user INTEGER NOT NULL,
      metadata TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Create whatsapp_message_throttle table for outbound notification throttling
  db.run(sql`
    CREATE TABLE IF NOT EXISTS whatsapp_message_throttle (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient TEXT NOT NULL UNIQUE,
      last_sent_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Add escalation columns to existing DBs safely
  try { sqlite.exec("ALTER TABLE messengers ADD COLUMN is_escalated INTEGER DEFAULT 0"); } catch { /* already exists */ }
  try { sqlite.exec("ALTER TABLE messengers ADD COLUMN escalation_status TEXT DEFAULT 'none'"); } catch { /* already exists */ }
  try { sqlite.exec("ALTER TABLE messengers ADD COLUMN claimed_by_agent_id TEXT"); } catch { /* already exists */ }
  try { sqlite.exec("ALTER TABLE messengers ADD COLUMN claimed_at TEXT"); } catch { /* already exists */ }
  try { sqlite.exec("ALTER TABLE messengers ADD COLUMN escalation_requested_at TEXT"); } catch { /* already exists */ }
  try { sqlite.exec("ALTER TABLE messengers ADD COLUMN released_at TEXT"); } catch { /* already exists */ }
  try { sqlite.exec("ALTER TABLE messengers ADD COLUMN escalation_tag TEXT"); } catch { /* already exists */ }
  try { sqlite.exec("ALTER TABLE messengers ADD COLUMN escalation_summary TEXT"); } catch { /* already exists */ }

  // Create index for faster history queries
  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_chat_messages_messenger
    ON chat_messages(messenger_id, platform, created_at DESC)
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_messengers_escalation
    ON messengers(is_escalated, escalation_status, updated_at DESC)
  `);

  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_whatsapp_throttle_recipient
    ON whatsapp_message_throttle(recipient)
  `);

  console.log("✅ Database initialized successfully");
}

// Export schema for use in queries
export { schema };
