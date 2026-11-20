import { supabaseAdmin } from "../../db_connection.js";
import { canSeeAllTasks, canTouchTask, getTaskForCompany } from "../lib/tasks.js";
import { createNotifications } from "../lib/notifications.js";

const table = "task_comments";
const MAX_BODY = 4000;

// Mentions are stored inside the text as @[Name](userId); the picker on the page writes them.
const MENTION = /@\[([^\]]{1,80})\]\((\d+)\)/g;

export function parseMentionIds(body) {
  return [...new Set([...String(body).matchAll(MENTION)].map((m) => m[2]))];
}

/** "hello @[Sara](4)" -> "hello @Sara" (for notification previews) */
export function plainText(body) {
  return String(body).replace(MENTION, "@$1");
}

async function loadTask(req) {
  const companyId = req.user?.company_id;
  const taskId = req.query.task_id ?? req.body?.task_id;
  if (!taskId) return { status: 400, error: "task_id is required" };
  const task = await getTaskForCompany(companyId, taskId, "id, title, company_id, assignee_id, created_by");
  if (!task || !canTouchTask(req.user, task)) return { status: 404, error: "Task not found" };
  return { task };
}

/**
 * Only people who can open the task get mentioned (a member can't see other people's tasks).
 * @returns { allowed: [{id, name}], skipped: [name] }
 */
async function resolveMentions(companyId, task, ids) {
  if (ids.length === 0) return { allowed: [], skipped: [] };
  const { data, error } = await supabaseAdmin.from("users").select("id, name, role, status").eq("company_id", companyId).in("id", ids);
  if (error) throw error;
  const allowed = [];
  const skipped = [];
  for (const u of data || []) {
    if (u.status === "blocked" || u.status === "inactive") skipped.push(u.name);
    else if (canTouchTask({ id: u.id, role: u.role }, task)) allowed.push({ id: u.id, name: u.name });
    else skipped.push(u.name);
  }
  return { allowed, skipped };
}

async function notifyComment({ companyId, task, author, body, mentioned, onlyNew = null }) {
  try {
    const preview = plainText(body).slice(0, 140);
    const mentionIds = new Set(mentioned.map((m) => String(m.id)));
    const rows = [];
    for (const m of mentioned) {
      if (String(m.id) === String(author.id)) continue;
      if (onlyNew && !onlyNew.has(String(m.id))) continue;
      rows.push({ company_id: companyId, recipient_type: "team_member", recipient_id: m.id, type: "task_mention", title: `${author.name} mentioned you on "${task.title}"`, body: preview, related_type: "task", related_id: task.id });
    }
    if (!onlyNew) {
      for (const id of new Set([task.assignee_id, task.created_by].filter(Boolean).map(String))) {
        if (id === String(author.id) || mentionIds.has(id)) continue;
        rows.push({ company_id: companyId, recipient_type: "team_member", recipient_id: id, type: "task_comment", title: `${author.name} commented on "${task.title}"`, body: preview, related_type: "task", related_id: task.id });
      }
    }
    if (rows.length) await createNotifications(rows);
  } catch (err) {
    console.error("[task-comments] notification failed:", err.message);
  }
}

async function withAuthors(comments) {
  const ids = [...new Set(comments.map((c) => c.author_id).filter(Boolean))];
  const { data, error } = ids.length ? await supabaseAdmin.from("users").select("id, name").in("id", ids) : { data: [], error: null };
  if (error) throw error;
  const names = Object.fromEntries((data || []).map((u) => [String(u.id), u.name]));
  return comments.map((c) => ({ ...c, author_name: c.author_id ? names[String(c.author_id)] ?? "Someone" : "Deleted user" }));
}

/** GET /api/task-comments?task_id= */
export async function list(req, res) {
  try {
    const loaded = await loadTask(req);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("company_id", req.user.company_id)
      .eq("task_id", loaded.task.id)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    return res.json({ comments: await withAuthors(data || []) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** POST /api/task-comments { task_id, body } */
export async function create(req, res) {
  try {
    const loaded = await loadTask(req);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    const body = String(req.body?.body ?? "").trim();
    if (!body) return res.status(400).json({ error: "Write something first" });
    if (body.length > MAX_BODY) return res.status(400).json({ error: `Comment is too long (max ${MAX_BODY} characters)` });

    const companyId = req.user.company_id;
    const { allowed, skipped } = await resolveMentions(companyId, loaded.task, parseMentionIds(body));

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert({ task_id: loaded.task.id, company_id: companyId, author_id: req.user.id, body, mentions: allowed.map((m) => m.id) })
      .select("*")
      .single();
    if (error) throw error;

    await notifyComment({ companyId, task: loaded.task, author: req.user, body, mentioned: allowed });
    const [withAuthor] = await withAuthors([data]);
    return res.status(201).json({ ...withAuthor, skipped_mentions: skipped });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

async function loadComment(req) {
  const { data, error } = await supabaseAdmin.from(table).select("*").eq("id", req.params.id).eq("company_id", req.user.company_id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const task = await getTaskForCompany(req.user.company_id, data.task_id, "id, title, company_id, assignee_id, created_by");
  if (!task || !canTouchTask(req.user, task)) return null;
  return { comment: data, task };
}

/** PUT /api/task-comments/:id { body } — author only. */
export async function update(req, res) {
  try {
    const found = await loadComment(req);
    if (!found) return res.status(404).json({ error: "Not found" });
    if (String(found.comment.author_id) !== String(req.user.id)) return res.status(403).json({ error: "You can only edit your own comments" });

    const body = String(req.body?.body ?? "").trim();
    if (!body) return res.status(400).json({ error: "Write something first" });
    if (body.length > MAX_BODY) return res.status(400).json({ error: `Comment is too long (max ${MAX_BODY} characters)` });

    const companyId = req.user.company_id;
    const { allowed, skipped } = await resolveMentions(companyId, found.task, parseMentionIds(body));
    const { data, error } = await supabaseAdmin
      .from(table)
      .update({ body, mentions: allowed.map((m) => m.id), edited_at: new Date().toISOString() })
      .eq("id", found.comment.id)
      .eq("company_id", companyId)
      .select("*")
      .single();
    if (error) throw error;

    // Only people newly mentioned by the edit get a notification.
    const before = new Set((found.comment.mentions ?? []).map(String));
    const added = new Set(allowed.filter((m) => !before.has(String(m.id))).map((m) => String(m.id)));
    if (added.size) await notifyComment({ companyId, task: found.task, author: req.user, body, mentioned: allowed, onlyNew: added });

    const [withAuthor] = await withAuthors([data]);
    return res.json({ ...withAuthor, skipped_mentions: skipped });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** DELETE /api/task-comments/:id — the author, or a manager and above. */
export async function remove(req, res) {
  try {
    const found = await loadComment(req);
    if (!found) return res.status(404).json({ error: "Not found" });
    const mine = String(found.comment.author_id) === String(req.user.id);
    if (!mine && !canSeeAllTasks(req.user)) return res.status(403).json({ error: "You can only delete your own comments" });
    const { error } = await supabaseAdmin.from(table).delete().eq("id", found.comment.id).eq("company_id", req.user.company_id);
    if (error) throw error;
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
