import { pgTable, integer, text, boolean, serial, unique } from "drizzle-orm/pg-core";

const nowIso = () => new Date().toISOString();

/**
 * Businesses Table
 * One row per registered vendor/tenant (salon, photographer, tutor, ...).
 * Each business owns its own Telegram bot and/or WhatsApp (Evolution API) instance.
 */
export const businesses = pgTable("businesses", {
  id: text("id").primaryKey(), // e.g. "biz_a1b2c3"
  name: text("name").notNull(),
  sector: text("sector").notNull(), // salon | tutor | photography | clinic | ...
  owner_email: text("owner_email"),
  // Mirror of chatbot-builder's business_config.chatbot_enabled, which is the
  // source of truth. Kept here only so a business row can be rendered without a
  // second service call; PATCH writes through to chatbot-builder.
  chatbot_enabled: integer("chatbot_enabled").default(1),

  // Owner-editable profile (Settings → Business profile).
  timezone: text("timezone"),
  contact_phone: text("contact_phone"),
  address: text("address"),
  description: text("description"), // fed to the chatbot as business context
  // Per-day opening hours as JSON: { "monday": { enabled, open, close }, ... }.
  // The Appointment service reads this to gate availability per tenant.
  business_hours: text("business_hours"),

  telegram_bot_token: text("telegram_bot_token"),
  telegram_bot_username: text("telegram_bot_username"),
  telegram_webhook_secret: text("telegram_webhook_secret"), // per-business secret validated on inbound webhook

  whatsapp_instance_name: text("whatsapp_instance_name"), // Evolution API instance name (== business id by convention)
  whatsapp_instance_token: text("whatsapp_instance_token"), // Evolution API per-instance token

  created_at: text("created_at").$defaultFn(nowIso),
  updated_at: text("updated_at").$defaultFn(nowIso)
});

/**
 * Messengers Table
 * Stores user information across different messaging platforms
 * Each user can have multiple entries (one per platform per business)
 */
export const messengers = pgTable(
  "messengers",
  {
    id: serial("id").primaryKey(),
    messenger_id: text("messenger_id").notNull(), // Platform-specific ID (e.g., "tg_123456789", "web_session_abc")
    platform: text("platform").notNull(), // "telegram", "web", "whatsapp", "facebook"
    business_id: text("business_id").notNull().default("biz_default"), // Tenant that owns this conversation
    first_name: text("first_name"),
    last_name: text("last_name"),
    username: text("username"),
    phone: text("phone"),
    preferred_language: text("preferred_language").default("en"),
    linked_user_id: text("linked_user_id"), // Optional: link to main user system
    metadata: text("metadata"), // JSON string for platform-specific data
    is_escalated: integer("is_escalated").default(0), // 1 = escalated to human agent
    escalation_status: text("escalation_status").default("none"), // "none" | "queued" | "claimed"
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

/**
 * Chat Messages Table
 * Stores complete chat history for all conversations
 */
export const chatMessages = pgTable("chat_messages", {
  id: serial("id").primaryKey(),
  messenger_id: text("messenger_id").notNull(), // References messengers.messenger_id
  platform: text("platform").notNull(), // Denormalized for faster queries
  business_id: text("business_id").notNull().default("biz_default"), // Tenant that owns this conversation
  message_text: text("message_text").notNull(),
  is_from_user: boolean("is_from_user").notNull(), // true = customer, false = AI reply
  metadata: text("metadata"), // JSON string for attachments, buttons, etc.
  created_at: text("created_at").$defaultFn(nowIso)
});

/**
 * WhatsApp Notification Throttle
 * Stores the most recent outbound notification timestamp per recipient.
 */
export const whatsappMessageThrottle = pgTable("whatsapp_message_throttle", {
  id: serial("id").primaryKey(),
  recipient: text("recipient").notNull().unique(), // E.164-like number without "+" (e.g. 94771234567)
  last_sent_at: text("last_sent_at").notNull(),
  created_at: text("created_at").$defaultFn(nowIso),
  updated_at: text("updated_at").$defaultFn(nowIso)
});

// Type exports for TypeScript
export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type Messenger = typeof messengers.$inferSelect;
export type NewMessenger = typeof messengers.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type WhatsAppMessageThrottle = typeof whatsappMessageThrottle.$inferSelect;
export type NewWhatsAppMessageThrottle = typeof whatsappMessageThrottle.$inferInsert;
