
import type { PlatformAdapter } from "./PlatformAdapter";
import { TelegramAdapter } from "./TelegramAdapter";
import { WebAdapter } from "./WebAdapter";
import { WhatsAppAdapter } from "./whatsapp";

let telegramAdapter: TelegramAdapter | null = null;
let webAdapter: WebAdapter | null = null;
let whatsappAdapter: WhatsAppAdapter | null = null;

/** Initialize all platform adapters */
export async function initializePlatforms(): Promise<void> {
  console.log("🚀 Initializing platform adapters...");

  telegramAdapter = new TelegramAdapter();
  await telegramAdapter.initialize?.();

  webAdapter = new WebAdapter();
  await webAdapter.initialize?.();

  whatsappAdapter = new WhatsAppAdapter();
  await whatsappAdapter.initialize?.();

  console.log("✅ All platform adapters initialized");
}

/** Get adapter for a specific platform */
export function getPlatformAdapter(platform: string): PlatformAdapter | null {
  switch (platform.toLowerCase()) {
    case "telegram":
      return telegramAdapter;
    case "web":
      return webAdapter;
    case "whatsapp":
      return whatsappAdapter;
    default:
      return null;
  }
}

/** Get all available platform names */
export function getAvailablePlatforms(): string[] {
  return ["telegram", "web", "whatsapp"];
}

/** Check if a platform is supported */
export function isPlatformSupported(platform: string): boolean {
  return getAvailablePlatforms().includes(platform.toLowerCase());
}

export { TelegramAdapter } from "./TelegramAdapter";
export { WebAdapter } from "./WebAdapter";
export { WhatsAppAdapter, sendWhatsAppMessage, sendWhatsAppTemplate } from "./whatsapp";
export type { PlatformAdapter, IncomingMessage, ReplyMessage, AIRequestPayload } from "./PlatformAdapter";
