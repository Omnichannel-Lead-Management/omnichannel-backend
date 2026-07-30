import type { Lead } from "../db/schema";

/**
 * Best-effort notification hook (task L7).
 * Fire-and-forget with a timeout; NEVER throws. If the Notification service is
 * a stub or down, a lead must still be created. Skipped under NODE_ENV=test.
 */
const NOTIFICATION_SERVICE_URL =
  process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3004";
const TIMEOUT_MS = 4000;

type NotifyReason = "new_lead" | "escalated_lead";

export async function notifyLeadEvent(reason: NotifyReason, lead: Lead): Promise<void> {
  if (process.env.NODE_ENV === "test" || process.env.NOTIFICATIONS_ENABLED === "false") {
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const payload = {
    type: reason,
    business_id: lead.business_id,
    lead_id: lead.id,
    messenger_id: lead.messenger_id,
    platform: lead.platform,
    score: lead.score,
    status: lead.status,
    service_interest: lead.service_interest ?? null
  };

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
  } catch (err) {
    console.warn(
      `[notify] could not reach notification service for ${reason}:`,
      err instanceof Error ? err.message : String(err)
    );
  } finally {
    clearTimeout(timer);
  }
}
