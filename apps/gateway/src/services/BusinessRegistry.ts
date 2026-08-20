import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { TelegramAdapter } from "../platforms/TelegramAdapter";
import { EvolutionAdapter } from "../platforms/EvolutionAdapter";
import type { PlatformAdapter } from "../platforms/PlatformAdapter";
import { parseBusinessHoursInput, serializeBusinessHours } from "./BusinessHours";

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const CHATBOT_SERVICE_URL = (process.env.CHATBOT_SERVICE_URL || "http://localhost:3003").replace(
  /\/$/,
  ""
);
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

export interface BusinessProfilePatch {
  name?: string;
  sector?: string;
  owner_email?: string | null;
  timezone?: string | null;
  contact_phone?: string | null;
  address?: string | null;
  description?: string | null;
  business_hours?: unknown;
  chatbot_enabled?: boolean;
}

/** "" clears an optional text field; undefined leaves it untouched. */
function optionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Update the owner-editable profile. */
export async function updateBusiness(
  id: string,
  patch: BusinessProfilePatch
): Promise<BusinessRow | undefined> {
  const existing = await getBusinessById(id);
  if (!existing) return undefined;

  const changes: Partial<typeof schema.businesses.$inferInsert> = {};

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new Error("Business name cannot be empty");
    changes.name = name;
  }
  if (patch.sector !== undefined) {
    const sector = patch.sector.trim();
    if (!sector) throw new Error("Sector cannot be empty");
    changes.sector = sector;
  }

  const owner_email = optionalText(patch.owner_email);
  if (owner_email !== undefined) changes.owner_email = owner_email;

  const timezone = optionalText(patch.timezone);
  if (timezone !== undefined) changes.timezone = timezone;

  const contact_phone = optionalText(patch.contact_phone);
  if (contact_phone !== undefined) changes.contact_phone = contact_phone;

  const address = optionalText(patch.address);
  if (address !== undefined) changes.address = address;

  const description = optionalText(patch.description);
  if (description !== undefined) changes.description = description;

  if (patch.business_hours !== undefined) {
    changes.business_hours =
      patch.business_hours === null
        ? null
        : serializeBusinessHours(parseBusinessHoursInput(patch.business_hours));
  }

  if (patch.chatbot_enabled !== undefined) {
    changes.chatbot_enabled = patch.chatbot_enabled ? 1 : 0;
    await syncChatbotEnabled(id, patch.chatbot_enabled);
  }

  if (Object.keys(changes).length === 0) return existing;

  changes.updated_at = new Date().toISOString();

  await db.update(schema.businesses).set(changes).where(eq(schema.businesses.id, id));

  return await getBusinessById(id);
}

/** Refresh our display copy of chatbot_enabled after chatbot-builder (the source of truth) accepted a change directly. */
export async function mirrorChatbotEnabled(business_id: string, enabled: boolean): Promise<void> {
  try {
    await db
      .update(schema.businesses)
      .set({ chatbot_enabled: enabled ? 1 : 0, updated_at: new Date().toISOString() })
      .where(eq(schema.businesses.id, business_id));
  } catch (err) {
    console.warn(
      `[businesses] could not mirror chatbot_enabled for ${business_id}:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

/** Best-effort mirror of the enabled flag into chatbot-builder, which is the source of truth for it. */
export async function syncChatbotEnabled(
  business_id: string,
  enabled: boolean
): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(
      `${CHATBOT_SERVICE_URL}/api/businesses/${encodeURIComponent(business_id)}/config`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbot_enabled: enabled }),
        signal: controller.signal
      }
    );
    if (!res.ok) return { ok: false, error: `chatbot service responded ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/** Save and verify a business's Telegram bot token, then register its webhook. */
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

/** Create this business's own Evolution API WhatsApp instance and point its webhook here. */
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

/** Construct a platform adapter scoped to one business's own stored credentials. */
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

export interface ConversationSummary {
  messenger_id: string;
  platform: string;
  display_name: string;
  is_escalated: boolean;
  escalation_status: string | null;
  claimed_by_agent_id: string | null;
  last_message: { text: string; is_from_user: boolean; created_at: string | null } | null;
  updated_at: string | null;
}

/** Every conversation for a business across all platforms, with a last-message preview. */
export async function listConversations(business_id: string): Promise<ConversationSummary[]> {
  const messengers = await db
    .select()
    .from(schema.messengers)
    .where(eq(schema.messengers.business_id, business_id))
    .orderBy(desc(schema.messengers.updated_at));

  const summaries: ConversationSummary[] = [];
  for (const messenger of messengers) {
    const lastMessage = await db
      .select()
      .from(schema.chatMessages)
      .where(
        and(
          eq(schema.chatMessages.messenger_id, messenger.messenger_id),
          eq(schema.chatMessages.platform, messenger.platform),
          eq(schema.chatMessages.business_id, business_id)
        )
      )
      .orderBy(desc(schema.chatMessages.id))
      .limit(1)
      .then((rows) => rows[0]);

    const nameParts = [messenger.first_name, messenger.last_name].filter(Boolean).join(" ").trim();

    summaries.push({
      messenger_id: messenger.messenger_id,
      platform: messenger.platform,
      display_name: messenger.username || nameParts || messenger.messenger_id,
      is_escalated: Boolean(messenger.is_escalated),
      escalation_status: messenger.escalation_status,
      claimed_by_agent_id: messenger.claimed_by_agent_id,
      last_message: lastMessage
        ? {
            text: lastMessage.message_text,
            is_from_user: lastMessage.is_from_user,
            created_at: lastMessage.created_at
          }
        : null,
      updated_at: messenger.updated_at
    });
  }

  return summaries;
}
