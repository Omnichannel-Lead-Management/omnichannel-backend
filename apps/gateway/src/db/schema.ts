import { pgTable, integer, text, boolean, serial, unique } from "drizzle-orm/pg-core";

const nowIso = () => new Date().toISOString();

export const businesses = pgTable("businesses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sector: text("sector").notNull(),
  owner_email: text("owner_email"),
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

export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type Messenger = typeof messengers.$inferSelect;
export type NewMessenger = typeof messengers.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type WhatsAppMessageThrottle = typeof whatsappMessageThrottle.$inferSelect;
export type NewWhatsAppMessageThrottle = typeof whatsappMessageThrottle.$inferInsert;
