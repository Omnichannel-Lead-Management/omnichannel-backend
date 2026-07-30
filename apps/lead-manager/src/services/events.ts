import type { Lead } from "../db/schema";

/**
 * Tiny in-process pub/sub for real-time lead events, scoped by tenant.
 * The Web Dashboard subscribes via GET /api/leads/stream?businessId= (SSE) and
 * receives lead.created / lead.updated events for its business only.
 */
export type LeadEventType = "lead.created" | "lead.updated";

export interface LeadEvent {
  type: LeadEventType;
  businessId: string;
  lead: Lead;
  at: number;
}

type Subscriber = (event: LeadEvent) => void;

// businessId -> set of subscriber callbacks
const subscribers = new Map<string, Set<Subscriber>>();

export function subscribe(businessId: string, fn: Subscriber): () => void {
  let set = subscribers.get(businessId);
  if (!set) {
    set = new Set();
    subscribers.set(businessId, set);
  }
  set.add(fn);
  return () => {
    set!.delete(fn);
    if (set!.size === 0) subscribers.delete(businessId);
  };
}

export function publish(type: LeadEventType, lead: Lead): void {
  const set = subscribers.get(lead.business_id);
  if (!set || set.size === 0) return;
  const event: LeadEvent = { type, businessId: lead.business_id, lead, at: Date.now() };
  for (const fn of set) {
    try {
      fn(event);
    } catch (err) {
      console.error("[events] subscriber threw:", err);
    }
  }
}
