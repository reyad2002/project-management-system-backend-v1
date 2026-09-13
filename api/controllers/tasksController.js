import { supabaseAdmin } from "../../db_connection.js";
import {
  taskStatuses,
  taskPriorities,
  getProjectForCompany,
  getTaskForCompany,
  validatePhaseBelongsToProject,
  validateUserInCompany,
  computeCompletedAt,
  enrichTasks,
} from "../lib/tasks.js";

const table = "tasks";

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

    const parent = await getTaskForCompany(companyId, taskId, "id");
    if (!parent) return res.status(404).json({ error: "Task not found" });

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

    const project = await getProjectForCompany(companyId, projectId, "id");
    if (!project) return res.status(404).json({ error: "Project not found" });

    const {
      title,
      description,
      phase_id,
      parent_task_id,
      status,
      priority,
      assignee_id,
      start_date,
      due_date,
    } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    if (status != null && !taskStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    if (priority != null && !taskPriorities.includes(priority)) {
      return res.status(400).json({ error: "Invalid priority" });
    }

    if (start_date && due_date && new Date(due_date) < new Date(start_date)) {
      return res.status(400).json({ error: "due_date must be on or after start_date" });
    }

    const phaseCheck = await validatePhaseBelongsToProject(companyId, projectId, phase_id);
    if (!phaseCheck.valid) return res.status(400).json({ error: phaseCheck.error });

    if (assignee_id) {
      const belongs = await validateUserInCompany(companyId, assignee_id);
      if (!belongs) return res.status(400).json({ error: "Invalid assignee_id for this company" });
    }

    let finalParentTaskId = null;
    if (parent_task_id) {
      const parent = await getTaskForCompany(companyId, parent_task_id, "id, project_id");
      if (!parent || String(parent.project_id) !== String(projectId)) {
        return res
          .status(400)
          .json({ error: "Subtask must belong to the same project as its parent task" });
      }
      finalParentTaskId = parent_task_id;
    }

    const finalStatus = status ?? "todo";

    // append to the end of this status column
    const { count, error: countErr } = await supabaseAdmin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .eq("status", finalStatus);
    if (countErr) throw countErr;

    const payload = {
      company_id: companyId,
      project_id: projectId,
      phase_id: phase_id ?? null,
      parent_task_id: finalParentTaskId,
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      status: finalStatus,
      priority: priority ?? "medium",
      assignee_id: assignee_id ?? null,
      start_date: start_date ?? null,
      due_date: due_date ?? null,
      completed_at: finalStatus === "done" ? new Date().toISOString() : null,
      position: count ?? 0,
      created_by: userId,
    };

    const { data, error } = await supabaseAdmin.from(table).insert(payload).select("*").single();
    if (error) throw error;

    const [enriched] = await enrichTasks(companyId, [data]);
    return res.status(201).json(enriched);
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
    if (!existing) return res.status(404).json({ error: "Not found" });

    const {
      title,
      description,
      phase_id,
      parent_task_id,
      status,
      priority,
      assignee_id,
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

    if (assignee_id !== undefined && assignee_id !== null) {
      const belongs = await validateUserInCompany(companyId, assignee_id);
      if (!belongs) return res.status(400).json({ error: "Invalid assignee_id for this company" });
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
      ...(assignee_id !== undefined ? { assignee_id } : {}),
      ...(start_date !== undefined ? { start_date } : {}),
      ...(due_date !== undefined ? { due_date } : {}),
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

    const existing = await getTaskForCompany(companyId, taskId, "id, status");
    if (!existing) return res.status(404).json({ error: "Not found" });

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
