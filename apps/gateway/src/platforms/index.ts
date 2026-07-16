/**
 * Platform Adapter Registry
 *
 * Central registry for all messaging platform adapters
 * Makes it easy to add new platforms by just adding them here
 */

import type { PlatformAdapter } from "./PlatformAdapter";
import { TelegramAdapter } from "./TelegramAdapter";
import { WebAdapter } from "./WebAdapter";
import { WhatsAppAdapter } from "./whatsapp";

// Global adapter instances
let telegramAdapter: TelegramAdapter | null = null;
let webAdapter: WebAdapter | null = null;
let whatsappAdapter: WhatsAppAdapter | null = null;

/**
 * Initialize all platform adapters
 */
export async function initializePlatforms(): Promise<void> {
  console.log("🚀 Initializing platform adapters...");

  // Initialize Telegram
  telegramAdapter = new TelegramAdapter();
  await telegramAdapter.initialize?.();

  // Initialize Web
  webAdapter = new WebAdapter();
  await webAdapter.initialize?.();

  // Initialize WhatsApp
  whatsappAdapter = new WhatsAppAdapter();
  await whatsappAdapter.initialize?.();

  // Easy to add more platforms here:
  // facebookAdapter = new FacebookAdapter();

  console.log("✅ All platform adapters initialized");
}

/**
 * Get adapter for a specific platform
 */
export function getPlatformAdapter(platform: string): PlatformAdapter | null {
  switch (platform.toLowerCase()) {
    case "telegram":
      return telegramAdapter;
    case "web":
      return webAdapter;
    case "whatsapp":
      return whatsappAdapter;
    // Add more platforms here:
    // case "facebook":
    //   return facebookAdapter;
    default:
      return null;
  }
}

/**
 * Get all available platform names
 */
export function getAvailablePlatforms(): string[] {
  return ["telegram", "web", "whatsapp"];
  // Add more as you implement them
}

/**
 * Check if a platform is supported
 */
export function isPlatformSupported(platform: string): boolean {
  return getAvailablePlatforms().includes(platform.toLowerCase());
}

// Export adapters and types
export { TelegramAdapter } from "./TelegramAdapter";
export { WebAdapter } from "./WebAdapter";
export { WhatsAppAdapter, sendWhatsAppMessage, sendWhatsAppTemplate } from "./whatsapp";
export type { PlatformAdapter, IncomingMessage, ReplyMessage, AIRequestPayload } from "./PlatformAdapter";
