import type { Appointment } from "../types/appointment";
import { createNotificationClient, requestJson, type HttpFetch, type NotificationClient } from "./notification-client";

export interface BusinessEmailProfile {
  id: string;
  name: string;
  owner_email?: string | null;
}

export function createBusinessEmailProfileProvider(options: { url?: string; fetcher?: HttpFetch; timeoutMs?: number } = {}) {
  return async (businessId: string): Promise<BusinessEmailProfile | null> => {
    const url = (options.url ?? process.env.GATEWAY_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const body = await requestJson(options.fetcher ?? fetch,
      `${url}/api/businesses/${encodeURIComponent(businessId)}`, options.timeoutMs ?? 4_000
    ) as { business?: BusinessEmailProfile } | null;
    const profile = body?.business;
    if (!profile || profile.id !== businessId || typeof profile.name !== "string" || !profile.name.trim()) return null;
    return profile;
  };
}

export interface ConfirmationEmailDependencies {
  getBusinessProfile: (businessId: string) => Promise<BusinessEmailProfile | null>;
  notificationClient: NotificationClient;
  diagnostic?: (reason: string) => void;
}

export async function sendConfirmationEmail(appointment: Appointment, dependencies: ConfirmationEmailDependencies = {
  getBusinessProfile: createBusinessEmailProfileProvider(),
  notificationClient: createNotificationClient(),
}): Promise<void> {
  const diagnostic = (reason: string) => {
    // Never log profiles, recipients, payloads, or raw upstream errors.
    try { (dependencies.diagnostic ?? console.warn)(`[appointment-email] ${reason}`); } catch { /* diagnostics must not fail confirmation */ }
  };
  try {
    const profile = await dependencies.getBusinessProfile(appointment.businessId);
    if (!profile || profile.id !== appointment.businessId) {
      diagnostic("business profile unavailable or mismatched; skipped");
      return;
    }
    const recipient = typeof profile.owner_email === "string" ? profile.owner_email.trim() : "";
    if (!recipient) {
      diagnostic("owner email missing; skipped");
      return;
    }
    await dependencies.notificationClient.sendEmail({
      business_id: appointment.businessId,
      recipient_email: recipient,
      template: "appointment_confirmed",
      data: {
        appointment_id: appointment.id,
        business_name: profile.name,
        customer_name: appointment.customerName,
        service: appointment.service,
        start_time: appointment.startTime,
        end_time: appointment.endTime,
      },
    });
  } catch {
    diagnostic("delivery or profile lookup failed; no retry");
  }
}
