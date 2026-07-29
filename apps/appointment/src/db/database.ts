import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";

const DEFAULT_DATABASE_PATH = "../../data/appointments.db";

export function createDatabase(databasePath?: string): Database {
  const resolvedPath =
    databasePath ?? process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;

  if (resolvedPath !== ":memory:") {
    mkdirSync(dirname(resolvedPath), { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.run("PRAGMA foreign_keys = ON");

  return db;
}
