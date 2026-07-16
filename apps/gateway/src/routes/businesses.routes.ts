import { Elysia, t } from "elysia";
import {
  connectTelegram,
  connectWhatsAppEvolution,
  createBusiness,
  getBusinessById,
  getEvolutionConnectionStatus,
  refetchEvolutionQrCode
} from "../services/BusinessRegistry";

/** Strip secrets before returning a business row over the API. */
function toPublicBusiness(business: Awaited<ReturnType<typeof getBusinessById>>) {
  if (!business) return null;

  return {
    id: business.id,
    name: business.name,
    sector: business.sector,
    owner_email: business.owner_email,
    chatbot_enabled: Boolean(business.chatbot_enabled),
    telegram_connected: Boolean(business.telegram_bot_token),
    telegram_bot_username: business.telegram_bot_username,
    whatsapp_connected: Boolean(business.whatsapp_instance_name),
    whatsapp_instance_name: business.whatsapp_instance_name,
    created_at: business.created_at,
    updated_at: business.updated_at
  };
}

export const businessesRoutes = new Elysia({ prefix: "/api/businesses" })
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const business = await createBusiness(body);
        set.status = 201;
        return { success: true, business: toPublicBusiness(business) };
      } catch (error) {
        set.status = 400;
        return { success: false, error: error instanceof Error ? error.message : "Failed to create business" };
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        sector: t.String({ minLength: 1 }),
        owner_email: t.Optional(t.String())
      }),
      detail: { summary: "Register a new business (vendor/tenant)", tags: ["Businesses"] }
    }
  )

  .get(
    "/:id",
    async ({ params, set }) => {
      const business = await getBusinessById(params.id);
      if (!business) {
        set.status = 404;
        return { success: false, error: "Business not found" };
      }
      return { success: true, business: toPublicBusiness(business) };
    },
    { detail: { summary: "Get a business by id", tags: ["Businesses"] } }
  )

  .post(
    "/:id/channels/telegram",
    async ({ params, body, set }) => {
      try {
        const result = await connectTelegram(params.id, body.bot_token);
        return { success: true, ...result };
      } catch (error) {
        set.status = 400;
        return { success: false, error: error instanceof Error ? error.message : "Failed to connect Telegram" };
      }
    },
    {
      body: t.Object({ bot_token: t.String({ minLength: 1 }) }),
      detail: {
        summary: "Save a business's Telegram bot token and register its webhook",
        tags: ["Businesses"]
      }
    }
  )

  .post(
    "/:id/channels/whatsapp-evolution",
    async ({ params, set }) => {
      try {
        const result = await connectWhatsAppEvolution(params.id);
        return { success: true, ...result };
      } catch (error) {
        set.status = 400;
        return { success: false, error: error instanceof Error ? error.message : "Failed to connect WhatsApp" };
      }
    },
    {
      detail: {
        summary: "Create this business's Evolution API instance and return a QR code to scan",
        tags: ["Businesses"]
      }
    }
  )

  .get(
    "/:id/channels/whatsapp-evolution/qrcode",
    async ({ params, set }) => {
      try {
        const result = await refetchEvolutionQrCode(params.id);
        return { success: true, ...result };
      } catch (error) {
        set.status = 400;
        return { success: false, error: error instanceof Error ? error.message : "Failed to refetch QR code" };
      }
    },
    {
      detail: {
        summary: "Re-fetch a fresh QR code if the previous one expired before scanning",
        tags: ["Businesses"]
      }
    }
  )

  .get(
    "/:id/channels/whatsapp-evolution/status",
    async ({ params }) => {
      const result = await getEvolutionConnectionStatus(params.id);
      return { success: true, ...result };
    },
    { detail: { summary: "Poll WhatsApp connection status for this business", tags: ["Businesses"] } }
  );
