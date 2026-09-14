export interface BusinessProfile {
  id: string;
  name: string;
  owner_email: string;
}

const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only return profiles suitable for email; any lookup failure preserves legacy alerts. */
export async function getBusinessProfile(businessId: string): Promise<BusinessProfile | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const baseUrl = process.env.GATEWAY_SERVICE_URL ?? "http://localhost:3000";
    const response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/api/businesses/${encodeURIComponent(businessId)}`,
      { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal }
    );
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || !("success" in payload) || payload.success !== true ||
        !("business" in payload)) return null;
    const business = payload.business;
    if (!business || typeof business !== "object" || !("id" in business) || business.id !== businessId ||
        !("name" in business) || typeof business.name !== "string" || !business.name.trim() ||
        !("owner_email" in business) || typeof business.owner_email !== "string" ||
        !EMAIL_ADDRESS.test(business.owner_email.trim())) return null;
    return { id: businessId, name: business.name.trim(), owner_email: business.owner_email.trim() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
