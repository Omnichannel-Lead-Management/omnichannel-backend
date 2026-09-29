import {
  pgTable,
  integer,
  text,
  boolean,
  serial,
  unique,
  index,
  doublePrecision
} from "drizzle-orm/pg-core";

const nowIso = () => new Date().toISOString();

export const businesses = pgTable("businesses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sector: text("sector").notNull(),
  owner_email: text("owner_email"),
  owner_name: text("owner_name"),
  password_hash: text("password_hash"),
  chatbot_enabled: integer("chatbot_enabled").default(1),

  timezone: text("timezone"),
  contact_phone: text("contact_phone"),
  address: text("address"),
  description: text("description"),
  business_hours: text("business_hours"),

  telegram_bot_token: text("telegram_bot_token"),
  telegram_bot_username: text("telegram_bot_username"),
  telegram_webhook_secret: text("telegram_webhook_secret"),

  whatsapp_instance_name: text("whatsapp_instance_name"),
  whatsapp_instance_token: text("whatsapp_instance_token"),

  /** Rate card this tenant is billed on. Null means the default plan. */
  pricing_plan_id: text("pricing_plan_id"),
  /** Set by an admin to pause billing without deleting the tenant. */
  billing_active: integer("billing_active").default(1),

  created_at: text("created_at").$defaultFn(nowIso),
  updated_at: text("updated_at").$defaultFn(nowIso)
});

export const messengers = pgTable(
  "messengers",
  {
    id: serial("id").primaryKey(),
    messenger_id: text("messenger_id").notNull(),
    platform: text("platform").notNull(),
    business_id: text("business_id").notNull().default("biz_default"),
    first_name: text("first_name"),
    last_name: text("last_name"),
    username: text("username"),
    phone: text("phone"),
    preferred_language: text("preferred_language").default("en"),
    linked_user_id: text("linked_user_id"),
    metadata: text("metadata"),
    is_escalated: integer("is_escalated").default(0),
    escalation_status: text("escalation_status").default("none"),
    claimed_by_agent_id: text("claimed_by_agent_id"),
    claimed_at: text("claimed_at"),
    escalation_requested_at: text("escalation_requested_at"),
    released_at: text("released_at"),
    escalation_tag: text("escalation_tag"),
    escalation_summary: text("escalation_summary"),
    created_at: text("created_at").$defaultFn(nowIso),
    updated_at: text("updated_at").$defaultFn(nowIso)
  },
  (table) => [unique().on(table.messenger_id, table.platform, table.business_id)]
);

export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  messenger_id: text("messenger_id").notNull(),
  platform: text("platform").notNull(),
  business_id: text("business_id").notNull().default("biz_default"),
  message_text: text("message_text").notNull(),
  is_from_user: boolean("is_from_user").notNull(),
  metadata: text("metadata"),
  created_at: text("created_at").$defaultFn(nowIso)
});

export const whatsappMessageThrottle = pgTable("whatsapp_message_throttle", {
  id: serial("id").primaryKey(),
  recipient: text("recipient").notNull().unique(),
  last_sent_at: text("last_sent_at").notNull(),
  created_at: text("created_at").$defaultFn(nowIso),
  updated_at: text("updated_at").$defaultFn(nowIso)
});

/**
 * Platform staff. Entirely separate from `businesses`: an admin has no
 * business_id and never gains access to tenant conversations.
 */
export const platformAdmins = pgTable("platform_admins", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  password_hash: text("password_hash").notNull(),
  /** "owner" may manage other admins; "staff" may not. */
  role: text("role").notNull().default("staff"),
  is_active: integer("is_active").notNull().default(1),
  last_login_at: text("last_login_at"),
  created_at: text("created_at").$defaultFn(nowIso),
  updated_at: text("updated_at").$defaultFn(nowIso)
});

/**
 * One row per billable AI operation. This is the meter behind the AI line on
 * an invoice, so rows are append-only and never rewritten once an invoice has
 * been issued over the period that contains them.
 *
 * The rate card prices a *unit*, not a row. Every call currently records one
 * unit, so a tenant can reconcile their bill against a count of operations;
 * `units` is the seam for weighting an expensive call kind later without
 * changing the invoice format.
 */
export const usageEvents = pgTable(
  "usage_events",
  {
    id: serial("id").primaryKey(),
    business_id: text("business_id").notNull(),
    /** ai_reply | ai_voice | ai_vision | ai_other */
    kind: text("kind").notNull(),
    units: integer("units").notNull().default(1),
    model: text("model"),
    metadata: text("metadata"),
    occurred_at: text("occurred_at").notNull().$defaultFn(nowIso),
    created_at: text("created_at").$defaultFn(nowIso)
  },
  (table) => [index("idx_usage_events_business").on(table.business_id, table.occurred_at)]
);

/**
 * A rate card. Admins edit these; a business points at one. Prices are per
 * unit, in the plan's own currency, and `included_*` are the allowances given
 * away before metered pricing starts.
 */
export const pricingPlans = pgTable("pricing_plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  currency: text("currency").notNull().default("LKR"),

  monthly_fee: doublePrecision("monthly_fee").notNull().default(0),

  included_ai_requests: integer("included_ai_requests").notNull().default(0),
  price_per_ai_request: doublePrecision("price_per_ai_request").notNull().default(0),

  included_conversations: integer("included_conversations").notNull().default(0),
  price_per_conversation: doublePrecision("price_per_conversation").notNull().default(0),

  included_messages: integer("included_messages").notNull().default(0),
  price_per_message: doublePrecision("price_per_message").notNull().default(0),

  tax_percent: doublePrecision("tax_percent").notNull().default(0),

  /** The plan new tenants are billed on when none is assigned. */
  is_default: integer("is_default").notNull().default(0),
  /** Archived plans stay readable for invoices already issued against them. */
  archived: integer("archived").notNull().default(0),

  created_at: text("created_at").$defaultFn(nowIso),
  updated_at: text("updated_at").$defaultFn(nowIso)
});

/**
 * A bill for one tenant over one period.
 *
 * Totals are stored, not recomputed on read: a plan's prices change, and an
 * invoice already sent must keep saying what it said when it was sent.
 * `usage_json` is the snapshot of counts the totals were derived from.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    number: text("number").notNull().unique(),
    business_id: text("business_id").notNull(),
    pricing_plan_id: text("pricing_plan_id"),
    plan_name: text("plan_name"),

    /** draft | sent | paid | void */
    status: text("status").notNull().default("draft"),
    currency: text("currency").notNull().default("LKR"),

    period_start: text("period_start").notNull(),
    period_end: text("period_end").notNull(),

    subtotal: doublePrecision("subtotal").notNull().default(0),
    tax_percent: doublePrecision("tax_percent").notNull().default(0),
    tax: doublePrecision("tax").notNull().default(0),
    total: doublePrecision("total").notNull().default(0),

    notes: text("notes"),
    usage_json: text("usage_json"),

    issued_at: text("issued_at"),
    due_date: text("due_date"),
    sent_at: text("sent_at"),
    /** Why the last send attempt failed, so the admin is not left guessing. */
    send_error: text("send_error"),
    paid_at: text("paid_at"),
    voided_at: text("voided_at"),

    created_by: text("created_by"),
    created_at: text("created_at").$defaultFn(nowIso),
    updated_at: text("updated_at").$defaultFn(nowIso)
  },
  (table) => [index("idx_invoices_business").on(table.business_id, table.period_start)]
);

export const invoiceLineItems = pgTable(
  "invoice_line_items",
  {
    id: serial("id").primaryKey(),
    invoice_id: text("invoice_id").notNull(),
    /** subscription | ai_requests | conversations | messages | adjustment */
    kind: text("kind").notNull(),
    description: text("description").notNull(),
    quantity: doublePrecision("quantity").notNull().default(0),
    unit_price: doublePrecision("unit_price").notNull().default(0),
    amount: doublePrecision("amount").notNull().default(0),
    sort_order: integer("sort_order").notNull().default(0)
  },
  (table) => [index("idx_invoice_items_invoice").on(table.invoice_id)]
);

export type PlatformAdmin = typeof platformAdmins.$inferSelect;
export type NewPlatformAdmin = typeof platformAdmins.$inferInsert;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;
export type PricingPlan = typeof pricingPlans.$inferSelect;
export type NewPricingPlan = typeof pricingPlans.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceLineItem = typeof invoiceLineItems.$inferSelect;
export type NewInvoiceLineItem = typeof invoiceLineItems.$inferInsert;

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type Messenger = typeof messengers.$inferSelect;
export type NewMessenger = typeof messengers.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type WhatsAppMessageThrottle = typeof whatsappMessageThrottle.$inferSelect;
export type NewWhatsAppMessageThrottle = typeof whatsappMessageThrottle.$inferInsert;
