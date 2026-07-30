import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { sql } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as schema from "./schema";

// Database path from environment or a local default.
const dbPath = process.env.DATABASE_PATH || "./sqlite/leads.db";

// Ensure the parent directory exists so bun:sqlite can create the file.
// (Use fs.mkdirSync — do NOT shell out to `rm`; that breaks on Windows.)
if (dbPath !== ":memory:") {
  mkdirSync(dirname(dbPath), { recursive: true });
}

const sqlite = new Database(dbPath, { create: true });
sqlite.exec("PRAGMA foreign_keys = ON");
sqlite.exec("PRAGMA journal_mode = WAL");

export const db = drizzle(sqlite, { schema });

/**
 * Create tables + indexes if they don't exist. Idempotent — safe to run on
 * every startup (task L1).
 */
export async function initDatabase(): Promise<void> {
  console.log("🔧 Initializing leads database...");

  db.run(sql`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      messenger_id TEXT NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      score INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL,
      channel_source TEXT,
      assigned_agent_id TEXT,
      tags TEXT,
      notes TEXT,
      service_interest TEXT,
      budget_range TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_contact_at INTEGER,
      converted_at INTEGER,
      conversion_value REAL
    )
  `);

  db.run(sql`
    CREATE TABLE IF NOT EXISTS lead_activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id TEXT NOT NULL,
      business_id TEXT NOT NULL,
      activity_type TEXT NOT NULL,
      description TEXT NOT NULL,
      performed_by TEXT,
      metadata TEXT,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(sql`CREATE INDEX IF NOT EXISTS idx_leads_business ON leads(business_id, status)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_leads_agent ON leads(assigned_agent_id, status)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(business_id, score DESC)`);
  db.run(sql`CREATE INDEX IF NOT EXISTS idx_lead_activities_lead ON lead_activities(lead_id, created_at)`);

  console.log("✅ Leads database initialized");
}

export { schema };
