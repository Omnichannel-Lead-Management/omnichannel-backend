import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { TelegramAdapter } from "../platforms/TelegramAdapter";
import { EvolutionAdapter } from "../platforms/EvolutionAdapter";
import type { PlatformAdapter } from "../platforms/PlatformAdapter";

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || "http://localhost:8080").replace(/\/$/, "");
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || "";

function generateBusinessId(): string {
  return `biz_${Math.random().toString(36).slice(2, 10)}`;
}

function generateWebhookSecret(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

type BusinessRow = typeof schema.businesses.$inferSelect;

export async function createBusiness(input: {
  name: string;
  sector: string;
  owner_email?: string;
}): Promise<BusinessRow> {
  const id = generateBusinessId();

  await db.insert(schema.businesses).values({
    id,
    name: input.name,
    sector: input.sector,
    owner_email: input.owner_email
  });

  const business = await getBusinessById(id);
  if (!business) throw new Error("Failed to create business");
  return business;
}

export async function getBusinessById(id: string): Promise<BusinessRow | undefined> {
  return await db
    .select()
    .from(schema.businesses)
    .where(eq(schema.businesses.id, id))
    .then((rows) => rows[0]);
}

/**
 * Save a vendor's Telegram bot token, verify it, and point Telegram's webhook
 * at this business's dedicated path so inbound updates resolve to business_id.
 */
export async function connectTelegram(
  business_id: string,
  bot_token: string
): Promise<{ ok: true; bot_username?: string }> {
  const business = await getBusinessById(business_id);
  if (!business) throw new Error("Business not found");

  const trimmedToken = bot_token.trim();
  if (!trimmedToken) throw new Error("bot_token is required");

  const meRes = await fetch(`https://api.telegram.org/bot${trimmedToken}/getMe`);
  const meJson = (await meRes.json()) as {
    ok: boolean;
    result?: { username?: string };
    description?: string;
  };
  if (!meJson.ok) {
    throw new Error(meJson.description || "Invalid Telegram bot token");
  }

  const webhookSecret = generateWebhookSecret();
  const webhookUrl = `${PUBLIC_BASE_URL}/webhook/telegram/${business_id}`;

  const setWebhookRes = await fetch(`https://api.telegram.org/bot${trimmedToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, secret_token: webhookSecret })
  });
  const setWebhookJson = (await setWebhookRes.json()) as { ok: boolean; description?: string };
  if (!setWebhookJson.ok) {
    throw new Error(setWebhookJson.description || "Failed to set Telegram webhook");
  }

  await db
    .update(schema.businesses)
    .set({
      telegram_bot_token: trimmedToken,
      telegram_bot_username: meJson.result?.username ?? null,
      telegram_webhook_secret: webhookSecret,
      updated_at: new Date().toISOString()
    })
    .where(eq(schema.businesses.id, business_id));

  return { ok: true, bot_username: meJson.result?.username };
}

/**
 * Create a dedicated Evolution API "instance" for this business (one WhatsApp
 * number per vendor) and point its webhook at this gateway's business-scoped route.
 */
export async function connectWhatsAppEvolution(
  business_id: string
): Promise<{ ok: true; instance_name: string; qrcode?: string }> {
  const business = await getBusinessById(business_id);
  if (!business) throw new Error("Business not found");
  if (!EVOLUTION_API_KEY) throw new Error("EVOLUTION_API_KEY is not configured");

  const instanceName = business_id;

  const createRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
    body: JSON.stringify({ instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS" })
  });

  if (!createRes.ok) {
    const detail = await createRes.text();
    throw new Error(`Evolution instance create failed (${createRes.status}): ${detail}`);
  }

  const createJson = (await createRes.json()) as {
    hash?: string;
    qrcode?: { base64?: string };
  };
  const instanceToken = createJson.hash ?? "";

  const webhookRes = await fetch(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY },
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: `${PUBLIC_BASE_URL}/webhook/evolution/${business_id}`,
        byEvents: false,
        events: ["MESSAGES_UPSERT"]
      }
    })
  });

  if (!webhookRes.ok) {
    const detail = await webhookRes.text();
    throw new Error(`Failed to configure Evolution webhook (${webhookRes.status}): ${detail}`);
  }

  await db
    .update(schema.businesses)
    .set({
      whatsapp_instance_name: instanceName,
      whatsapp_instance_token: instanceToken,
      updated_at: new Date().toISOString()
    })
    .where(eq(schema.businesses.id, business_id));

  return { ok: true, instance_name: instanceName, qrcode: createJson.qrcode?.base64 };
}

/** Re-fetch a fresh QR code for a business's already-created Evolution instance. */
export async function refetchEvolutionQrCode(business_id: string): Promise<{ ok: true; qrcode?: string }> {
  const business = await getBusinessById(business_id);
  if (!business?.whatsapp_instance_name) throw new Error("WhatsApp is not connected for this business yet");
  if (!EVOLUTION_API_KEY) throw new Error("EVOLUTION_API_KEY is not configured");

  const res = await fetch(`${EVOLUTION_API_URL}/instance/connect/${business.whatsapp_instance_name}`, {
    headers: { apikey: EVOLUTION_API_KEY }
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Failed to refetch QR code (${res.status}): ${detail}`);
  }

  const json = (await res.json()) as { base64?: string };
  return { ok: true, qrcode: json.base64 };
}

/** Check whether a business's Evolution instance is currently connected. */
export async function getEvolutionConnectionStatus(
  business_id: string
): Promise<{ connected: boolean; status: string }> {
  const business = await getBusinessById(business_id);
  if (!business?.whatsapp_instance_name) {
    return { connected: false, status: "not_connected" };
  }
  if (!EVOLUTION_API_KEY) {
    return { connected: false, status: "evolution_api_key_missing" };
  }

  const res = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${business.whatsapp_instance_name}`, {
    headers: { apikey: EVOLUTION_API_KEY }
  });

  if (!res.ok) {
    return { connected: false, status: "unknown" };
  }

  const json = (await res.json()) as { instance?: { state?: string } };
  const state = json.instance?.state ?? "unknown";
  return { connected: state === "open", status: state };
}

/**
 * Construct a platform adapter scoped to one business, using that business's
 * own stored credentials — separate from the global .env-based singleton
 * adapters used by the legacy single-tenant webhook routes.
 */
export function resolveAdapterForBusiness(platform: string, business: BusinessRow): PlatformAdapter | null {
  if (platform === "telegram") {
    if (!business.telegram_bot_token) return null;
    return new TelegramAdapter(business.telegram_bot_token);
  }

  if (platform === "whatsapp") {
    if (!business.whatsapp_instance_name) return null;
    const apiKey = business.whatsapp_instance_token || EVOLUTION_API_KEY;
    return new EvolutionAdapter(business.whatsapp_instance_name, apiKey, EVOLUTION_API_URL);
  }

  return null;
}
