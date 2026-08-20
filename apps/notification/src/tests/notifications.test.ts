import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { createApp } from "../app";
import { createDatabase, initializeDatabase } from "../db";

const businessId = "biz_salon";

function post(app: ReturnType<typeof createApp>, path: string, body?: unknown): Promise<Response> {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  );
}

function leadEvent(overrides: Record<string, unknown> = {}) {
  return {
    type: "new_lead",
    business_id: businessId,
    lead_id: "lead_abc",
    messenger_id: "tg_1",
    platform: "telegram",
    score: 72,
    status: "new",
    service_interest: "Bridal package",
    ...overrides
  };
}

describe("notification service", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDatabase(":memory:");
    initializeDatabase(db);
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
  });

  test("a lead event is stored as an in-app notification", async () => {
    const response = await post(app, "/api/notifications/email", leadEvent());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.stored).toBe(true);
    expect(body.email_sent).toBe(false);
    expect(body.notification.type).toBe("lead");
    expect(body.notification.title).toBe("New lead");
    expect(body.notification.body).toContain("Bridal package");
    expect(body.notification.action_url).toBe("/leads/lead_abc");
    expect(body.notification.is_read).toBe(false);
  });

  test("an escalated lead reads differently from a new one", async () => {
    await post(app, "/api/notifications/email", leadEvent({ type: "escalated_lead" }));

    const body = await (
      await app.handle(new Request(`http://localhost/api/businesses/${businessId}/notifications`))
    ).json();

    expect(body.notifications[0].title).toBe("Lead escalated");
  });

  test("an event without a business_id is rejected", async () => {
    const response = await post(app, "/api/notifications/email", leadEvent({ business_id: "" }));

    expect(response.status).toBe(400);
  });

  test("an unrecognised event type is accepted but not stored", async () => {
    const response = await post(app, "/api/notifications/email", leadEvent({ type: "something" }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body.stored).toBe(false);
  });

  test("notifications are scoped to their business", async () => {
    await post(app, "/api/notifications/email", leadEvent());
    await post(app, "/api/notifications/email", leadEvent({ business_id: "biz_other" }));

    const body = await (
      await app.handle(new Request(`http://localhost/api/businesses/${businessId}/notifications`))
    ).json();

    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].business_id).toBe(businessId);
    expect(body.unread_count).toBe(1);
  });

  test("unread filtering and marking one read", async () => {
    await post(app, "/api/notifications/email", leadEvent());
    await post(app, "/api/notifications/email", leadEvent({ lead_id: "lead_def" }));

    const listed = await (
      await app.handle(new Request(`http://localhost/api/businesses/${businessId}/notifications`))
    ).json();
    const target = listed.notifications[0].id;

    const marked = await app.handle(
      new Request(
        `http://localhost/api/businesses/${businessId}/notifications/${target}/read`,
        { method: "PATCH" }
      )
    );
    const markedBody = await marked.json();

    expect(marked.status).toBe(200);
    expect(markedBody.notification.is_read).toBe(true);
    expect(markedBody.unread_count).toBe(1);

    const unread = await (
      await app.handle(
        new Request(`http://localhost/api/businesses/${businessId}/notifications?unread=true`)
      )
    ).json();

    expect(unread.notifications).toHaveLength(1);
    expect(unread.notifications[0].id).not.toBe(target);
  });

  test("one tenant cannot mark another tenant's notification read", async () => {
    await post(app, "/api/notifications/email", leadEvent());
    const listed = await (
      await app.handle(new Request(`http://localhost/api/businesses/${businessId}/notifications`))
    ).json();
    const target = listed.notifications[0].id;

    const response = await app.handle(
      new Request(`http://localhost/api/businesses/biz_other/notifications/${target}/read`, {
        method: "PATCH"
      })
    );

    expect(response.status).toBe(404);

    const stillUnread = await (
      await app.handle(
        new Request(`http://localhost/api/businesses/${businessId}/notifications?unread=true`)
      )
    ).json();
    expect(stillUnread.notifications).toHaveLength(1);
  });

  test("read-all clears the unread count for that business only", async () => {
    await post(app, "/api/notifications/email", leadEvent());
    await post(app, "/api/notifications/email", leadEvent({ lead_id: "lead_def" }));
    await post(app, "/api/notifications/email", leadEvent({ business_id: "biz_other" }));

    const response = await post(app, `/api/businesses/${businessId}/notifications/read-all`);
    const body = await response.json();

    expect(body.marked_read).toBe(2);
    expect(body.unread_count).toBe(0);

    const other = await (
      await app.handle(new Request(`http://localhost/api/businesses/biz_other/notifications`))
    ).json();
    expect(other.unread_count).toBe(1);
  });
});
