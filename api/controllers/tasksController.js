import { supabaseAdmin } from "../../db_connection.js";
import {
  taskStatuses,
  taskPriorities,
  taskAssigneeTypes,
  getProjectForCompany,
  getTaskForCompany,
  validatePhaseBelongsToProject,
  validateUserInCompany,
  validateClientAssigneeForProject,
  createTaskForProject,
  computeCompletedAt,
  enrichTasks,
  INTERNAL_PROJECT,
  canSeeAllTasks,
  canTouchTask,
} from "../lib/tasks.js";
import { createNotification } from "../lib/notifications.js";
import { getPortalProject } from "../lib/portal.js";
import { generateDueRecurringTasks } from "../lib/taskRecurrence.js";

const table = "tasks";

/** Create recurring tasks that fell due before the list / numbers are read (throttled; never blocks the page). */
async function catchUpRecurring(companyId) {
  try {
    await generateDueRecurringTasks({ companyId, throttleMs: 300_000 });
  } catch (err) {
    console.error("[tasks] recurring catch-up failed:", err.message);
  }
}

/** Tell the assignee they got a task (never the person who assigned it to themselves). Must not break the request. */
async function notifyAssigned(task, actor) {
  if (task.assignee_type !== "team_member" || !task.assignee_id) return;
  if (String(task.assignee_id) === String(actor?.id)) return;
  try {
    await createNotification({
      company_id: task.company_id,
      recipient_type: "team_member",
      recipient_id: task.assignee_id,
      type: "task_assigned",
      title: `New task assigned: ${task.title}`,
      body: task.due_date ? `Due ${task.due_date}` : null,
      related_type: "task",
      related_id: task.id,
    });
  } catch (err) {
    console.error("[tasks] assignment notification failed:", err.message);
  }
}

export async function listByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const projectId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const project = await getProjectForCompany(companyId, projectId, "id");
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { status, assignee_id, priority, parent_task_id } = req.query;

    let query = supabaseAdmin
      .from(table)
      .select("*")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    if (!parent_task_id || parent_task_id === "root") {
      query = query.is("parent_task_id", null);
    } else {
      query = query.eq("parent_task_id", parent_task_id);
    }

    if (status) {
      if (!taskStatuses.includes(status)) return res.status(400).json({ error: "Invalid status" });
      query = query.eq("status", status);
    }
    if (priority) {
      if (!taskPriorities.includes(priority)) return res.status(400).json({ error: "Invalid priority" });
      query = query.eq("priority", priority);
    }
    if (assignee_id) query = query.eq("assignee_id", assignee_id);
    if (!canSeeAllTasks(req.user)) query = query.or(`assignee_id.eq.${req.user.id},created_by.eq.${req.user.id}`);

    const { data, error } = await query;
    if (error) throw error;

    const tasks = await enrichTasks(companyId, data || []);
    return res.json({ tasks });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getSubtasks(req, res) {
  try {
    const companyId = req.user?.company_id;
    const taskId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const parent = await getTaskForCompany(companyId, taskId, "id, assignee_id, created_by");
    if (!parent || !canTouchTask(req.user, parent)) return res.status(404).json({ error: "Task not found" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("company_id", companyId)
      .eq("parent_task_id", taskId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;

    const tasks = await enrichTasks(companyId, data || []);
    return res.json({ tasks });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function createByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id || req.user?.sub;
    const projectId = req.params.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const project = await getProjectForCompany(companyId, projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const result = await createTaskForProject(companyId, userId, project, req.body);
    if (result.error) return res.status(result.status).json({ error: result.error });

    if (result.notifyClientAssigneeId) {
      await createNotification({
        company_id: companyId,
        recipient_type: "client_portal_user",
        recipient_id: result.notifyClientAssigneeId,
        type: "task_assigned_to_client",
        title: `New task assigned: ${result.task.title}`,
        body: result.task.description ?? null,
        related_type: "task",
        related_id: result.task.id,
      });
    }

    await notifyAssigned(result.task, req.user);

    const [enriched] = await enrichTasks(companyId, [result.task]);
    return res.status(201).json(enriched);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** POST /api/tasks — a task with an optional project (project_id omitted = internal company task). */
export async function createGeneral(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const { project_id: projectId, ...input } = req.body ?? {};
    let project = INTERNAL_PROJECT;
    if (projectId != null && projectId !== "") {
      project = await getProjectForCompany(companyId, projectId);
      if (!project) return res.status(404).json({ error: "Project not found" });
    }

    const result = await createTaskForProject(companyId, userId, project, input);
    if (result.error) return res.status(result.status).json({ error: result.error });

    if (result.notifyClientAssigneeId) {
      await createNotification({
        company_id: companyId,
        recipient_type: "client_portal_user",
        recipient_id: result.notifyClientAssigneeId,
        type: "task_assigned_to_client",
        title: `New task assigned: ${result.task.title}`,
        body: result.task.description ?? null,
        related_type: "task",
        related_id: result.task.id,
      });
    }
    await notifyAssigned(result.task, req.user);

    const [enriched] = await enrichTasks(companyId, [result.task]);
    return res.status(201).json(enriched);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (date, n) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

/**
 * GET /api/tasks — every task the caller may see, across projects and internal.
 * Query: scope=mine|all (managers+ only for "all"), status (comma list), priority, assignee_id ("me" ok),
 * project_id, internal=true, overdue=true, due_from, due_to, q, sort=completed, page, limit.
 */
export async function listAll(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    await catchUpRecurring(companyId);

    const { scope, status, priority, assignee_id, project_id, internal, overdue, due_from, due_to, q } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 100));

    let query = supabaseAdmin.from(table).select("*", { count: "exact" }).eq("company_id", companyId);

    const seeAll = canSeeAllTasks(req.user);
    if (!seeAll || scope === "mine") {
      query = query.or(`assignee_id.eq.${req.user.id},created_by.eq.${req.user.id}`);
    }

    if (status) {
      const list = String(status).split(",").filter(Boolean);
      if (list.some((s) => !taskStatuses.includes(s))) return res.status(400).json({ error: "Invalid status" });
      query = query.in("status", list);
    }
    if (priority) {
      if (!taskPriorities.includes(priority)) return res.status(400).json({ error: "Invalid priority" });
      query = query.eq("priority", priority);
    }
    if (assignee_id) query = query.eq("assignee_id", assignee_id === "me" ? req.user.id : assignee_id);
    if (project_id) query = query.eq("project_id", project_id);
    if (internal === "true") query = query.is("project_id", null);
    if (overdue === "true") query = query.neq("status", "done").lt("due_date", todayStr());
    if (due_from) query = query.gte("due_date", due_from);
    if (due_to) query = query.lte("due_date", due_to);
    if (q) {
      const term = String(q).replace(/[%,()]/g, " ").trim();
      if (term) query = query.ilike("title", `%${term}%`);
    }
    // Sub-tasks live under their parent; the list shows top-level tasks only.
    query = query.is("parent_task_id", null);

    const from = (page - 1) * limit;
    // sort=completed: most recently finished first (the board's "Done" column); default: soonest due first.
    const ordered =
      req.query.sort === "completed"
        ? query.order("completed_at", { ascending: false, nullsFirst: false })
        : query.order("due_date", { ascending: true, nullsFirst: false });
    const { data, error, count } = await ordered
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);
    if (error) throw error;

    const tasks = await enrichTasks(companyId, data || []);
    return res.json({ tasks, total: count ?? tasks.length, page, limit });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** GET /api/tasks/summary — the numbers on top of the My Tasks page (+ team workload for managers). */
export async function summary(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    await catchUpRecurring(companyId);

    const seeAll = canSeeAllTasks(req.user);
    const mineOnly = !seeAll || req.query.scope === "mine";
    const today = todayStr();
    const weekEnd = addDays(today, 7);

    let open = supabaseAdmin
      .from(table)
      .select("id, assignee_id, due_date, status")
      .eq("company_id", companyId)
      .neq("status", "done")
      .is("parent_task_id", null)
      .limit(5000);
    let doneRecently = supabaseAdmin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "done")
      .gte("completed_at", `${addDays(today, -7)}T00:00:00Z`);
    if (mineOnly) {
      const scopeFilter = `assignee_id.eq.${req.user.id},created_by.eq.${req.user.id}`;
      open = open.or(scopeFilter);
      doneRecently = doneRecently.or(scopeFilter);
    }

    const [openRes, doneRes] = await Promise.all([open, doneRecently]);
    if (openRes.error) throw openRes.error;
    if (doneRes.error) throw doneRes.error;

    const rows = openRes.data || [];
    const isOverdue = (t) => t.due_date && t.due_date < today;
    const result = {
      open: rows.length,
      overdue: rows.filter(isOverdue).length,
      dueToday: rows.filter((t) => t.due_date === today).length,
      dueThisWeek: rows.filter((t) => t.due_date && t.due_date >= today && t.due_date <= weekEnd).length,
      blocked: rows.filter((t) => t.status === "blocked").length,
      doneLast7Days: doneRes.count ?? 0,
      workload: [],
    };

    if (!mineOnly) {
      const byUser = new Map();
      for (const t of rows) {
        const key = t.assignee_id == null ? "unassigned" : String(t.assignee_id);
        const entry = byUser.get(key) ?? { user_id: t.assignee_id, open: 0, overdue: 0 };
        entry.open += 1;
        if (isOverdue(t)) entry.overdue += 1;
        byUser.set(key, entry);
      }
      const ids = [...byUser.values()].map((e) => e.user_id).filter(Boolean);
      const { data: users, error: usersErr } = ids.length
        ? await supabaseAdmin.from("users").select("id, name").in("id", ids)
        : { data: [], error: null };
      if (usersErr) throw usersErr;
      const nameById = Object.fromEntries((users || []).map((u) => [String(u.id), u.name]));
      result.workload = [...byUser.values()]
        .map((e) => ({ ...e, name: e.user_id ? nameById[String(e.user_id)] ?? "Unknown" : "Unassigned" }))
        .sort((a, b) => b.open - a.open);
    }

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

const BULK_MAX = 100;
const isDateStr = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/** The tasks of `ids` that the caller may change (others are silently left out and counted as skipped). */
async function touchableTasks(req, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return { error: "Choose at least one task", status: 400 };
  if (ids.length > BULK_MAX) return { error: `At most ${BULK_MAX} tasks at a time`, status: 400 };
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("id, title, company_id, assignee_id, created_by, due_date")
    .eq("company_id", req.user.company_id)
    .in("id", ids.map(String));
  if (error) throw error;
  const allowed = (data || []).filter((t) => canTouchTask(req.user, t));
  if (allowed.length === 0) return { error: "None of these tasks can be changed by you", status: 404 };
  return { allowed };
}

/**
 * POST /api/tasks/bulk-update { ids: [...], patch: { status?, priority?, assignee_id?, due_date? } }
 * Change many tasks in one go (the list's checkboxes).
 */
export async function bulkUpdate(req, res) {
  try {
    const { ids, patch } = req.body ?? {};
    if (!patch || typeof patch !== "object") return res.status(400).json({ error: "Nothing to change" });
    const update = {};
    if (patch.status !== undefined) {
      if (!taskStatuses.includes(patch.status)) return res.status(400).json({ error: "Invalid status" });
      update.status = patch.status;
    }
    if (patch.priority !== undefined) {
      if (!taskPriorities.includes(patch.priority)) return res.status(400).json({ error: "Invalid priority" });
      update.priority = patch.priority;
    }
    if (patch.due_date !== undefined) {
      if (patch.due_date !== null && !isDateStr(patch.due_date)) return res.status(400).json({ error: "due_date must be a date (YYYY-MM-DD) or empty" });
      update.due_date = patch.due_date;
      update.escalated_at = null;
    }
    if (patch.assignee_id !== undefined) {
      if (patch.assignee_id !== null && !(await validateUserInCompany(req.user.company_id, patch.assignee_id))) {
        return res.status(400).json({ error: "Invalid assignee_id for this company" });
      }
      update.assignee_id = patch.assignee_id;
    }
    if (Object.keys(update).length === 0) return res.status(400).json({ error: "Nothing to change" });

    const found = await touchableTasks(req, ids);
    if (found.error) return res.status(found.status).json({ error: found.error });
    let targets = found.allowed;

    // Client-assigned tasks keep their client (the two kinds of assignee can't be mixed).
    if (update.assignee_id !== undefined) {
      const { data: kinds, error: kindsError } = await supabaseAdmin.from(table).select("id, assignee_type").in("id", targets.map((t) => t.id));
      if (kindsError) throw kindsError;
      const teamIds = new Set((kinds || []).filter((k) => k.assignee_type !== "client").map((k) => String(k.id)));
      targets = targets.filter((t) => teamIds.has(String(t.id)));
      if (targets.length === 0) return res.status(400).json({ error: "These tasks are assigned to a client" });
    }

    const { error } = await supabaseAdmin
      .from(table)
      .update({ ...update, updated_at: new Date().toISOString() })
      .eq("company_id", req.user.company_id)
      .in("id", targets.map((t) => t.id));
    if (error) throw error;

    // One notification for the new assignee, however many tasks they just got.
    if (update.assignee_id && String(update.assignee_id) !== String(req.user.id)) {
      const handedOver = targets.filter((t) => String(t.assignee_id) !== String(update.assignee_id));
      if (handedOver.length) {
        try {
          await createNotification({
            company_id: req.user.company_id,
            recipient_type: "team_member",
            recipient_id: update.assignee_id,
            type: "task_assigned",
            title: handedOver.length === 1 ? `New task assigned: ${handedOver[0].title}` : `${handedOver.length} tasks assigned to you`,
            body: null,
            related_type: handedOver.length === 1 ? "task" : null,
            related_id: handedOver.length === 1 ? handedOver[0].id : null,
          });
        } catch (notifyError) {
          console.error("[tasks] bulk assignment notification failed:", notifyError.message);
        }
      }
    }

    return res.json({ updated: targets.length, skipped: ids.length - targets.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** POST /api/tasks/bulk-delete { ids: [...] } */
export async function bulkDelete(req, res) {
  try {
    const found = await touchableTasks(req, req.body?.ids);
    if (found.error) return res.status(found.status).json({ error: found.error });
    const { error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("company_id", req.user.company_id)
      .in("id", found.allowed.map((t) => t.id));
    if (error) throw error;
    return res.json({ deleted: found.allowed.length, skipped: req.body.ids.length - found.allowed.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** GET /api/tasks/preferences — { digest }: whether the daily e-mail digest is on for the caller. */
export async function getPreferences(req, res) {
  try {
    const { data, error } = await supabaseAdmin.from("users").select("task_digest_enabled").eq("id", req.user.id).maybeSingle();
    if (error) throw error;
    return res.json({ digest: data?.task_digest_enabled ?? true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** PUT /api/tasks/preferences { digest: boolean } */
export async function setPreferences(req, res) {
  try {
    if (typeof req.body?.digest !== "boolean") return res.status(400).json({ error: "digest must be true or false" });
    const { error } = await supabaseAdmin.from("users").update({ task_digest_enabled: req.body.digest }).eq("id", req.user.id);
    if (error) throw error;
    return res.json({ digest: req.body.digest });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** GET /api/tasks/:id */
export async function getOne(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    const task = await getTaskForCompany(companyId, req.params.id);
    if (!task || !canTouchTask(req.user, task)) return res.status(404).json({ error: "Not found" });
    const [enriched] = await enrichTasks(companyId, [task]);
    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const companyId = req.user?.company_id;
    const taskId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const existing = await getTaskForCompany(companyId, taskId);
    if (!existing || !canTouchTask(req.user, existing)) return res.status(404).json({ error: "Not found" });

    const {
      title,
      description,
      phase_id,
      parent_task_id,
      status,
      priority,
      assignee_id,
      assignee_type,
      client_assignee_id,
      start_date,
      due_date,
      position,
    } = req.body;

    if (status !== undefined && status !== null && !taskStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    if (priority !== undefined && priority !== null && !taskPriorities.includes(priority)) {
      return res.status(400).json({ error: "Invalid priority" });
    }

    const finalStartDate = start_date !== undefined ? start_date : existing.start_date;
    const finalDueDate = due_date !== undefined ? due_date : existing.due_date;
    if (finalStartDate && finalDueDate && new Date(finalDueDate) < new Date(finalStartDate)) {
      return res.status(400).json({ error: "due_date must be on or after start_date" });
    }

    if (phase_id !== undefined && phase_id !== null) {
      const phaseCheck = await validatePhaseBelongsToProject(companyId, existing.project_id, phase_id);
      if (!phaseCheck.valid) return res.status(400).json({ error: phaseCheck.error });
    }

    const finalAssigneeType = assignee_type !== undefined ? assignee_type : existing.assignee_type;
    if (assignee_type !== undefined && !taskAssigneeTypes.includes(assignee_type)) {
      return res.status(400).json({ error: "Invalid assignee_type" });
    }

    let notifyClientAssigneeId = null;
    if (finalAssigneeType === "client") {
      const finalClientAssigneeId = client_assignee_id !== undefined ? client_assignee_id : existing.client_assignee_id;
      if (!finalClientAssigneeId) {
        return res.status(400).json({ error: "client_assignee_id is required when assignee_type is 'client'" });
      }
      if (assignee_id) {
        return res.status(400).json({ error: "assignee_id must not be set when assignee_type is 'client'" });
      }
      if (client_assignee_id !== undefined && String(client_assignee_id) !== String(existing.client_assignee_id)) {
        const project = await getProjectForCompany(companyId, existing.project_id);
        const belongs = project && (await validateClientAssigneeForProject(companyId, project.client_id, finalClientAssigneeId));
        if (!belongs) return res.status(400).json({ error: "Invalid client_assignee_id for this project's client" });
        notifyClientAssigneeId = finalClientAssigneeId;
      }
    } else {
      if (client_assignee_id) {
        return res.status(400).json({ error: "client_assignee_id must not be set when assignee_type is 'team_member'" });
      }
      if (assignee_id !== undefined && assignee_id !== null) {
        const belongs = await validateUserInCompany(companyId, assignee_id);
        if (!belongs) return res.status(400).json({ error: "Invalid assignee_id for this company" });
      }
    }

    if (parent_task_id !== undefined && parent_task_id !== null) {
      if (String(parent_task_id) === String(taskId)) {
        return res.status(400).json({ error: "A task cannot be its own parent" });
      }
      const parent = await getTaskForCompany(companyId, parent_task_id, "id, project_id");
      if (!parent || String(parent.project_id) !== String(existing.project_id)) {
        return res
          .status(400)
          .json({ error: "Subtask must belong to the same project as its parent task" });
      }
    }

    const payload = {
      ...(title !== undefined ? { title: title ? String(title).trim() : null } : {}),
      ...(description !== undefined ? { description: description ? String(description).trim() : null } : {}),
      ...(phase_id !== undefined ? { phase_id } : {}),
      ...(parent_task_id !== undefined ? { parent_task_id } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(assignee_type !== undefined ? { assignee_type } : {}),
      ...(assignee_id !== undefined || assignee_type !== undefined
        ? { assignee_id: finalAssigneeType === "team_member" ? (assignee_id !== undefined ? assignee_id : existing.assignee_id) : null }
        : {}),
      ...(client_assignee_id !== undefined || assignee_type !== undefined
        ? { client_assignee_id: finalAssigneeType === "client" ? (client_assignee_id !== undefined ? client_assignee_id : existing.client_assignee_id) : null }
        : {}),
      ...(start_date !== undefined ? { start_date } : {}),
      ...(due_date !== undefined ? { due_date } : {}),
      // A moved due date starts a fresh chance to be flagged as long overdue.
      ...(due_date !== undefined && due_date !== existing.due_date ? { escalated_at: null } : {}),
      ...(position !== undefined ? { position } : {}),
      updated_at: new Date().toISOString(),
    };

    if (status !== undefined) {
      const completedAt = computeCompletedAt(status, existing.status);
      if (completedAt !== undefined) payload.completed_at = completedAt;
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(payload)
      .eq("id", taskId)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    if (notifyClientAssigneeId) {
      await createNotification({
        company_id: companyId,
        recipient_type: "client_portal_user",
        recipient_id: notifyClientAssigneeId,
        type: "task_assigned_to_client",
        title: `New task assigned: ${data.title}`,
        body: data.description ?? null,
        related_type: "task",
        related_id: data.id,
      });
    }
    if (String(data.assignee_id) !== String(existing.assignee_id)) await notifyAssigned(data, req.user);

    const [enriched] = await enrichTasks(companyId, [data]);
    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateStatus(req, res) {
  try {
    const companyId = req.user?.company_id;
    const taskId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { status } = req.body;
    if (!status || !taskStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const existing = await getTaskForCompany(companyId, taskId, "id, status, assignee_id, created_by");
    if (!existing || !canTouchTask(req.user, existing)) return res.status(404).json({ error: "Not found" });

    const completedAt = computeCompletedAt(status, existing.status);
    const payload = {
      status,
      updated_at: new Date().toISOString(),
      ...(completedAt !== undefined ? { completed_at: completedAt } : {}),
    };

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(payload)
      .eq("id", taskId)
      .eq("company_id", companyId)
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
    const taskId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const target = await getTaskForCompany(companyId, taskId, "id, assignee_id, created_by");
    if (!target || !canTouchTask(req.user, target)) return res.status(404).json({ error: "Not found" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("id", taskId)
      .eq("company_id", companyId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function reorder(req, res) {
  try {
    const companyId = req.user?.company_id;
    const projectId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const project = await getProjectForCompany(companyId, projectId, "id");
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { taskIds } = req.body;
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: "taskIds must be a non-empty array" });
    }

    const { data: existingTasks, error: existingErr } = await supabaseAdmin
      .from(table)
      .select("id")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .in("id", taskIds);
    if (existingErr) throw existingErr;
    if ((existingTasks || []).length !== taskIds.length) {
      return res.status(400).json({ error: "One or more taskIds do not belong to this project" });
    }

    await Promise.all(
      taskIds.map((id, index) =>
        supabaseAdmin
          .from(table)
          .update({ position: index, updated_at: new Date().toISOString() })
          .eq("id", id)
          .eq("company_id", companyId)
      )
    );

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("company_id", companyId)
      .in("id", taskIds);
    if (error) throw error;

    const byId = Object.fromEntries((data || []).map((t) => [String(t.id), t]));
    const ordered = taskIds.map((id) => byId[String(id)]).filter(Boolean);
    const tasks = await enrichTasks(companyId, ordered);

    return res.json({ tasks });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/portal/projects/:id/tasks — "Pending on Client": read-only list of open tasks
 * assigned to the current client on this project (assignee_type=client, status != done).
 */
export async function portalListPendingByProject(req, res) {
  try {
    const { company_id: companyId, client_id: clientId } = req.portalUser;
    const projectId = req.params.id;

    const project = await getPortalProject(companyId, clientId, projectId);
    if (!project) return res.status(404).json({ error: "Not found" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .eq("assignee_type", "client")
      .neq("status", "done")
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) throw error;

    return res.json({ tasks: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
