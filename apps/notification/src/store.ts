import type { Database } from "bun:sqlite";

export const NOTIFICATION_TYPES = ["lead", "appointment", "message", "system"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationRow {
  id: string;
  business_id: string;
  type: string;
  title: string;
  body: string;
  action_url: string | null;
  metadata: string | null;
  is_read: number;
  created_at: string;
}

export interface NotificationDto {
  id: string;
  business_id: string;
  type: string;
  title: string;
  body: string;
  action_url: string | null;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

export interface CreateNotificationInput {
  business_id: string;
  type: NotificationType;
  title: string;
  body?: string;
  action_url?: string | null;
  metadata?: Record<string, unknown> | null;
}

function toDto(row: NotificationRow): NotificationDto {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      const parsed = JSON.parse(row.metadata);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) metadata = parsed;
    } catch {
    }
  }

  return {
    id: row.id,
    business_id: row.business_id,
    type: row.type,
    title: row.title,
    body: row.body,
    action_url: row.action_url,
    metadata,
    is_read: row.is_read === 1,
    created_at: row.created_at
  };
}

export function createNotification(db: Database, input: CreateNotificationInput): NotificationDto {
  const id = `ntf_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const created_at = new Date().toISOString();

  db.query(
    `INSERT INTO notifications (id, business_id, type, title, body, action_url, metadata, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id,
    input.business_id,
    input.type,
    input.title,
    input.body ?? "",
    input.action_url ?? null,
    input.metadata ? JSON.stringify(input.metadata) : null,
    created_at
  );

  return toDto(
    db.query("SELECT * FROM notifications WHERE id = ?").get(id) as NotificationRow
  );
}

export function listNotifications(
  db: Database,
  business_id: string,
  filters: { unread?: boolean; type?: string; limit?: number } = {}
): NotificationDto[] {
  const clauses = ["business_id = ?"];
  const values: (string | number)[] = [business_id];

  if (filters.unread === true) clauses.push("is_read = 0");
  if (filters.unread === false) clauses.push("is_read = 1");
  if (filters.type) {
    clauses.push("type = ?");
    values.push(filters.type);
  }

  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);
  values.push(limit);

  const rows = db
    .query(
      `SELECT * FROM notifications
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(...values) as NotificationRow[];

  return rows.map(toDto);
}

export function countUnread(db: Database, business_id: string): number {
  const row = db
    .query("SELECT COUNT(*) AS count FROM notifications WHERE business_id = ? AND is_read = 0")
    .get(business_id) as { count: number };
  return row?.count ?? 0;
}

/** Scoped by business so one tenant can never mark another's notification read. */
export function markRead(db: Database, business_id: string, id: string): NotificationDto | null {
  db.query("UPDATE notifications SET is_read = 1 WHERE id = ? AND business_id = ?").run(
    id,
    business_id
  );

  const row = db
    .query("SELECT * FROM notifications WHERE id = ? AND business_id = ?")
    .get(id, business_id) as NotificationRow | null;

  return row ? toDto(row) : null;
}

export function markAllRead(db: Database, business_id: string): number {
  const before = countUnread(db, business_id);
  db.query("UPDATE notifications SET is_read = 1 WHERE business_id = ? AND is_read = 0").run(
    business_id
  );
  return before;
}
