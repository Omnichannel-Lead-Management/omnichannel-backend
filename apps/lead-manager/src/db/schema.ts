import { sqliteTable, integer, text, real, index } from "drizzle-orm/sqlite-core";

/**
 * Leads Table (leads.db)
 * One row per customer lead. Every row is scoped to a tenant via `business_id`,
 * and every query in this service MUST filter on it (multi-tenant isolation).
 * Timestamps are INTEGER unix-millis (Date.now()).
 */
export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(), // "lead_<uuid>"
    business_id: text("business_id").notNull(), // tenant isolation — never optional
    messenger_id: text("messenger_id").notNull(),
    platform: text("platform").notNull(), // telegram | whatsapp | web
    status: text("status").notNull().default("new"), // new|contacted|qualified|converted|lost
    score: integer("score").notNull().default(0), // 0-100
    source: text("source").notNull(), // chatbot | whatsapp | telegram | web | referral
    channel_source: text("channel_source"),
    assigned_agent_id: text("assigned_agent_id"),
    tags: text("tags"), // JSON array string
    notes: text("notes"),
    service_interest: text("service_interest"),
    budget_range: text("budget_range"), // low | medium | high
    created_at: integer("created_at").notNull(),
    updated_at: integer("updated_at").notNull(),
    last_contact_at: integer("last_contact_at"),
    converted_at: integer("converted_at"),
    conversion_value: real("conversion_value")
  },
  (table) => ({
    businessStatusIdx: index("idx_leads_business").on(table.business_id, table.status),
    agentStatusIdx: index("idx_leads_agent").on(table.assigned_agent_id, table.status),
    businessScoreIdx: index("idx_leads_score").on(table.business_id, table.score)
  })
);

/**
 * Lead Activities Table — append-only audit trail of everything that happens to
 * a lead: creation, status changes, notes, scoring, assignment.
 */
export const leadActivities = sqliteTable(
  "lead_activities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    lead_id: text("lead_id").notNull(),
    business_id: text("business_id").notNull(),
    activity_type: text("activity_type").notNull(), // lead_created|status_changed|note_added|assigned|scored
    description: text("description").notNull(),
    performed_by: text("performed_by"), // agent_id or "system"
    metadata: text("metadata"), // JSON: { old_value, new_value, ... }
    created_at: integer("created_at").notNull()
  },
  (table) => ({
    leadIdx: index("idx_lead_activities_lead").on(table.lead_id, table.created_at)
  })
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type LeadActivity = typeof leadActivities.$inferSelect;
export type NewLeadActivity = typeof leadActivities.$inferInsert;
