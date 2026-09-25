import { sqliteTable, integer, text, real, index } from "drizzle-orm/sqlite-core";

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    business_id: text("business_id").notNull(),
    messenger_id: text("messenger_id").notNull(),
    platform: text("platform").notNull(),
    status: text("status").notNull().default("new"),
    score: integer("score").notNull().default(0),
    source: text("source").notNull(),
    channel_source: text("channel_source"),
    assigned_agent_id: text("assigned_agent_id"),
    tags: text("tags"),
    notes: text("notes"),
    service_interest: text("service_interest"),
    budget_range: text("budget_range"),
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

export const leadActivities = sqliteTable(
  "lead_activities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    lead_id: text("lead_id").notNull(),
    business_id: text("business_id").notNull(),
    activity_type: text("activity_type").notNull(),
    description: text("description").notNull(),
    performed_by: text("performed_by"),
    metadata: text("metadata"),
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
