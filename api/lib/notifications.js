import { supabaseAdmin } from "../../db_connection.js";

const table = "notifications";

export const notificationTypes = [
  "meeting_reminder",
  "meeting_note_added",
  "action_item_assigned",
  "phase_approved",
  "task_assigned_to_client",
  "feedback_requested",
  "meeting_cancelled",
];

/**
 * Internal helper — insert a notification row. Not exposed as an endpoint; called from other
 * controllers when a relevant event happens (phase approved, meeting note added, etc).
 */
export async function createNotification({
  company_id,
  recipient_type,
  recipient_id,
  type,
  title,
  body = null,
  related_type = null,
  related_id = null,
}) {
  if (!company_id || !recipient_type || !recipient_id || !type || !title) {
    throw new Error("createNotification: company_id, recipient_type, recipient_id, type and title are required");
  }
  const { data, error } = await supabaseAdmin
    .from(table)
    .insert({ company_id, recipient_type, recipient_id, type, title, body, related_type, related_id })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Same as createNotification but for many recipients of the same type/event at once.
 */
export async function createNotifications(rows) {
  const payload = rows.filter(Boolean).map((r) => ({
    company_id: r.company_id,
    recipient_type: r.recipient_type,
    recipient_id: r.recipient_id,
    type: r.type,
    title: r.title,
    body: r.body ?? null,
    related_type: r.related_type ?? null,
    related_id: r.related_id ?? null,
  }));
  if (payload.length === 0) return [];

  const { data, error } = await supabaseAdmin.from(table).insert(payload).select("*");
  if (error) throw error;
  return data || [];
}

export async function listNotifications({ companyId, recipientType, recipientId, isRead, limit }) {
  let query = supabaseAdmin
    .from(table)
    .select("*")
    .eq("company_id", companyId)
    .eq("recipient_type", recipientType)
    .eq("recipient_id", recipientId)
    .order("created_at", { ascending: false });

  if (isRead !== undefined) query = query.eq("is_read", isRead);

  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  query = query.limit(limitNum);

  const { data, error } = await query;
  if (error) throw error;

  const { count, error: countErr } = await supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("recipient_type", recipientType)
    .eq("recipient_id", recipientId)
    .eq("is_read", false);
  if (countErr) throw countErr;

  return { notifications: data || [], unreadCount: count ?? 0 };
}

export async function markNotificationRead({ companyId, recipientType, recipientId, notificationId }) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .eq("company_id", companyId)
    .eq("recipient_type", recipientType)
    .eq("recipient_id", recipientId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function markAllNotificationsRead({ companyId, recipientType, recipientId }) {
  const { error } = await supabaseAdmin
    .from(table)
    .update({ is_read: true, read_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("recipient_type", recipientType)
    .eq("recipient_id", recipientId)
    .eq("is_read", false);
  if (error) throw error;
}
