import type { Lead } from "../db/schema";
import { getBusinessProfile } from "./business-profile";

const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3004";
// Notification's SMTP provider allows 10 seconds; leave time for storage and HTTP.
const TIMEOUT_MS = 15000;

type NotifyReason = "new_lead" | "escalated_lead";

export async function notifyLeadEvent(reason: NotifyReason, lead: Lead): Promise<void> {
  if (process.env.NODE_ENV === "test" || process.env.NOTIFICATIONS_ENABLED === "false") {
    return;
  }

  const business = reason === "new_lead" ? await getBusinessProfile(lead.business_id) : null;

  const payload = {
    type: reason,
    business_id: lead.business_id,
    lead_id: lead.id,
    messenger_id: lead.messenger_id,
    platform: lead.platform,
    score: lead.score,
    status: lead.status,
    service_interest: lead.service_interest ?? null,
    ...(business ? {
      template: "new_lead",
      recipient_email: business.owner_email,
      data: {
        lead_id: lead.id,
        business_name: business.name,
        service_interest: lead.service_interest ?? null,
        platform: lead.platform,
        score: lead.score
      }
    } : {})
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), reason === "new_lead" ? TIMEOUT_MS : 4000);
  try {
    const res = await fetch(`${NOTIFICATION_SERVICE_URL}/api/notifications/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!res.ok) {
      console.warn(`[notify] notification service responded ${res.status} for ${reason}`);
    }
    // Never retry/fall back after dispatch: even a failed response can mean the alert was stored.
  } catch (err) {
    console.warn(
      `[notify] could not reach notification service for ${reason}:`,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    clearTimeout(timer);
  }
}
