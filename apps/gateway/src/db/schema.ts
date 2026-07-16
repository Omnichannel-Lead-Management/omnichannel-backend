import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Messengers Table
 * Stores user information across different messaging platforms
 * Each user can have multiple entries (one per platform)
 */
export const messengers = sqliteTable("messengers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messenger_id: text("messenger_id").notNull(), // Platform-specific ID (e.g., "tg_123456789", "web_session_abc")
  platform: text("platform").notNull(), // "telegram", "web", "whatsapp", "facebook"
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
  created_at: text("created_at").default(sql`(datetime('now'))`),
  updated_at: text("updated_at").default(sql`(datetime('now'))`)
});

/**
 * Chat Messages Table
 * Stores complete chat history for all conversations
 */
export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  messenger_id: text("messenger_id").notNull(), // References messengers.messenger_id
  platform: text("platform").notNull(), // Denormalized for faster queries
  message_text: text("message_text").notNull(),
  is_from_user: integer("is_from_user", { mode: "boolean" }).notNull(), // true = customer, false = AI reply
  metadata: text("metadata"), // JSON string for attachments, buttons, etc.
  created_at: text("created_at").default(sql`(datetime('now'))`)
});

/**
 * WhatsApp Notification Throttle
 * Stores the most recent outbound notification timestamp per recipient.
 */
export const whatsappMessageThrottle = sqliteTable("whatsapp_message_throttle", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  recipient: text("recipient").notNull().unique(), // E.164-like number without "+" (e.g. 94771234567)
  last_sent_at: text("last_sent_at").notNull(),
  created_at: text("created_at").default(sql`(datetime('now'))`),
  updated_at: text("updated_at").default(sql`(datetime('now'))`)
});

// Type exports for TypeScript
export type Messenger = typeof messengers.$inferSelect;
export type NewMessenger = typeof messengers.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type WhatsAppMessageThrottle = typeof whatsappMessageThrottle.$inferSelect;
export type NewWhatsAppMessageThrottle = typeof whatsappMessageThrottle.$inferInsert;
