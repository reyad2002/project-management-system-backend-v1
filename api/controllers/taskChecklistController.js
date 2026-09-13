import { supabaseAdmin } from "../../db_connection.js";
import { getTaskForCompany } from "../lib/tasks.js";

const table = "task_checklist_items";

async function getItemWithTaskCheck(companyId, itemId) {
  const { data: item, error } = await supabaseAdmin.from(table).select("*").eq("id", itemId).maybeSingle();
  if (error) throw error;
  if (!item) return null;
  const task = await getTaskForCompany(companyId, item.task_id, "id");
  if (!task) return null;
  return item;
}

export async function listByTask(req, res) {
  try {
    const companyId = req.user?.company_id;
    const taskId = req.params.taskId;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const task = await getTaskForCompany(companyId, taskId, "id");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("task_id", taskId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;

    return res.json({ items: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    const taskId = req.params.taskId;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const task = await getTaskForCompany(companyId, taskId, "id");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const { title } = req.body;
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    const { count, error: countErr } = await supabaseAdmin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("task_id", taskId);
    if (countErr) throw countErr;

    const payload = {
      task_id: taskId,
      title: String(title).trim(),
      is_done: false,
      position: count ?? 0,
    };

    const { data, error } = await supabaseAdmin.from(table).insert(payload).select("*").single();
    if (error) throw error;

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const companyId = req.user?.company_id;
    const itemId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const existing = await getItemWithTaskCheck(companyId, itemId);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const { title, is_done, position } = req.body;

    const payload = {
      ...(title !== undefined ? { title: title ? String(title).trim() : null } : {}),
      ...(is_done !== undefined ? { is_done: Boolean(is_done) } : {}),
      ...(position !== undefined ? { position: Number(position) } : {}),
    };
    const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(clean)
      .eq("id", itemId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function remove(req, res) {
  try {
    const companyId = req.user?.company_id;
    const itemId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const existing = await getItemWithTaskCheck(companyId, itemId);
    if (!existing) return res.status(404).json({ error: "Not found" });

    const { error } = await supabaseAdmin.from(table).delete().eq("id", itemId);
    if (error) throw error;

    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
