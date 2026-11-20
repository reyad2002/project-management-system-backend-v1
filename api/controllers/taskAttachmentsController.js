import { supabaseAdmin } from "../../db_connection.js";
import { canSeeAllTasks, canTouchTask, getTaskForCompany } from "../lib/tasks.js";

const table = "task_attachments";
const MAX_PER_TASK = 50;

/** Accept http(s) links only (never javascript: or data: URLs, which would run when clicked). */
export function normalizeUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value || value.length > 2000) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

async function loadTask(req) {
  const taskId = req.query.task_id ?? req.body?.task_id;
  if (!taskId) return { status: 400, error: "task_id is required" };
  const task = await getTaskForCompany(req.user.company_id, taskId, "id, assignee_id, created_by");
  if (!task || !canTouchTask(req.user, task)) return { status: 404, error: "Task not found" };
  return { task };
}

/** GET /api/task-attachments?task_id= */
export async function list(req, res) {
  try {
    const loaded = await loadTask(req);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("company_id", req.user.company_id)
      .eq("task_id", loaded.task.id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return res.json({ attachments: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** POST /api/task-attachments { task_id, url, name? } */
export async function create(req, res) {
  try {
    const loaded = await loadTask(req);
    if (loaded.error) return res.status(loaded.status).json({ error: loaded.error });

    const url = normalizeUrl(req.body?.url);
    if (!url) return res.status(400).json({ error: "Enter a valid link (http or https)" });
    const name = String(req.body?.name ?? "").trim() || new URL(url).hostname;
    if (name.length > 200) return res.status(400).json({ error: "Name is too long (max 200)" });

    const { count, error: countError } = await supabaseAdmin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("company_id", req.user.company_id)
      .eq("task_id", loaded.task.id);
    if (countError) throw countError;
    if ((count ?? 0) >= MAX_PER_TASK) return res.status(400).json({ error: `A task can have at most ${MAX_PER_TASK} links` });

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert({ task_id: loaded.task.id, company_id: req.user.company_id, name, url, added_by: req.user.id })
      .select("*")
      .single();
    if (error) throw error;
    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** DELETE /api/task-attachments/:id — whoever added it, or a manager and above. */
export async function remove(req, res) {
  try {
    const { data: row, error } = await supabaseAdmin.from(table).select("*").eq("id", req.params.id).eq("company_id", req.user.company_id).maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ error: "Not found" });
    const task = await getTaskForCompany(req.user.company_id, row.task_id, "id, assignee_id, created_by");
    if (!task || !canTouchTask(req.user, task)) return res.status(404).json({ error: "Not found" });
    if (String(row.added_by) !== String(req.user.id) && !canSeeAllTasks(req.user)) {
      return res.status(403).json({ error: "You can only remove links you added" });
    }
    const { error: deleteError } = await supabaseAdmin.from(table).delete().eq("id", row.id).eq("company_id", req.user.company_id);
    if (deleteError) throw deleteError;
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
