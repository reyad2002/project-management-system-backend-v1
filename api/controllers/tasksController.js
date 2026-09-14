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
} from "../lib/tasks.js";
import { createNotification } from "../lib/notifications.js";
import { getPortalProject } from "../lib/portal.js";

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

    const [enriched] = await enrichTasks(companyId, [result.task]);
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
