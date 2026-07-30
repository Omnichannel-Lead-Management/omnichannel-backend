import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  driver: "bun:sqlite",
  dbCredentials: {
    url: process.env.DATABASE_PATH || "./sqlite/leads.db"
  }
} satisfies Config;
