import { supabaseAdmin } from "../../db_connection.js";

export const taskStatuses = ["todo", "in_progress", "in_review", "done", "blocked"];
export const taskPriorities = ["low", "medium", "high", "urgent"];
export const projectMemberRoles = ["owner", "manager", "contributor", "viewer"];
export const taskAssigneeTypes = ["team_member", "client"];

/**
 * Ensure a project exists and belongs to the given company. Returns the project row or null.
 */
export async function getProjectForCompany(companyId, projectId, fields = "id, company_id, client_id, status") {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select(fields)
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Ensure a task exists and belongs to the given company. Returns the task row or null.
 */
export async function getTaskForCompany(companyId, taskId, fields = "*") {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(fields)
    .eq("id", taskId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function validatePhaseBelongsToProject(companyId, projectId, phaseId) {
  if (!phaseId) return { valid: true };
  const { data, error } = await supabaseAdmin
    .from("phases")
    .select("id")
    .eq("id", phaseId)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { valid: false, error: "Phase does not belong to the specified project" };
  return { valid: true };
}

export async function validateUserInCompany(companyId, userId) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("id", userId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/**
 * Ensure a client_portal_users row belongs to the same company + client as the project it's
 * being assigned a task on (a client can only be assigned tasks on their own projects).
 */
export async function validateClientAssigneeForProject(companyId, projectClientId, clientAssigneeId) {
  const { data, error } = await supabaseAdmin
    .from("client_portal_users")
    .select("id")
    .eq("id", clientAssigneeId)
    .eq("company_id", companyId)
    .eq("client_id", projectClientId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/**
 * All validation for task creation — no DB writes. Exported so callers that create several
 * tasks in one request (e.g. meeting action items) can validate every one of them up front and
 * fail the whole request before writing anything, instead of leaving a partial result behind if
 * item N turns out to be invalid. `project` must already be scoped to the company (id, client_id).
 * Returns { valid: false, error, status } or { valid: true, finalAssigneeType, finalParentTaskId }.
 */
export async function validateTaskInput(companyId, project, input) {
  const {
    title,
    status,
    priority,
    assignee_id,
    assignee_type,
    client_assignee_id,
    start_date,
    due_date,
    phase_id,
    parent_task_id,
  } = input;

  if (!title || !String(title).trim()) {
    return { valid: false, error: "title is required", status: 400 };
  }
  if (status != null && !taskStatuses.includes(status)) {
    return { valid: false, error: "Invalid status", status: 400 };
  }
  if (priority != null && !taskPriorities.includes(priority)) {
    return { valid: false, error: "Invalid priority", status: 400 };
  }
  if (start_date && due_date && new Date(due_date) < new Date(start_date)) {
    return { valid: false, error: "due_date must be on or after start_date", status: 400 };
  }

  const phaseCheck = await validatePhaseBelongsToProject(companyId, project.id, phase_id);
  if (!phaseCheck.valid) return { valid: false, error: phaseCheck.error, status: 400 };

  const finalAssigneeType = assignee_type ?? "team_member";
  if (!taskAssigneeTypes.includes(finalAssigneeType)) {
    return { valid: false, error: "Invalid assignee_type", status: 400 };
  }

  if (finalAssigneeType === "client") {
    if (assignee_id) {
      return { valid: false, error: "assignee_id must not be set when assignee_type is 'client'", status: 400 };
    }
    if (!client_assignee_id) {
      return { valid: false, error: "client_assignee_id is required when assignee_type is 'client'", status: 400 };
    }
    const belongs = await validateClientAssigneeForProject(companyId, project.client_id, client_assignee_id);
    if (!belongs) return { valid: false, error: "Invalid client_assignee_id for this project's client", status: 400 };
  } else {
    if (client_assignee_id) {
      return { valid: false, error: "client_assignee_id must not be set when assignee_type is 'team_member'", status: 400 };
    }
    if (assignee_id) {
      const belongs = await validateUserInCompany(companyId, assignee_id);
      if (!belongs) return { valid: false, error: "Invalid assignee_id for this company", status: 400 };
    }
  }

  let finalParentTaskId = null;
  if (parent_task_id) {
    const parent = await getTaskForCompany(companyId, parent_task_id, "id, project_id");
    if (!parent || String(parent.project_id) !== String(project.id)) {
      return { valid: false, error: "Subtask must belong to the same project as its parent task", status: 400 };
    }
    finalParentTaskId = parent_task_id;
  }

  return { valid: true, finalAssigneeType, finalParentTaskId };
}

/**
 * Core task-creation logic shared by POST /api/projects/:id/tasks and meeting action items
 * (POST /api/meetings/:id/notes). `project` must already be scoped to the company (id, client_id).
 * Returns { error, status } on validation failure, or { task, notifyClientAssigneeId }.
 */
export async function createTaskForProject(companyId, userId, project, input) {
  const { title, description, phase_id, assignee_id, client_assignee_id, start_date, due_date, status, priority, source, source_id } = input;

  const v = await validateTaskInput(companyId, project, input);
  if (!v.valid) return { error: v.error, status: v.status };
  const { finalAssigneeType, finalParentTaskId } = v;

  const finalStatus = status ?? "todo";

  // append to the end of this status column
  const { count, error: countErr } = await supabaseAdmin
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("project_id", project.id)
    .eq("status", finalStatus);
  if (countErr) throw countErr;

  const payload = {
    company_id: companyId,
    project_id: project.id,
    phase_id: phase_id ?? null,
    parent_task_id: finalParentTaskId,
    title: String(title).trim(),
    description: description ? String(description).trim() : null,
    status: finalStatus,
    priority: priority ?? "medium",
    assignee_type: finalAssigneeType,
    assignee_id: finalAssigneeType === "team_member" ? assignee_id ?? null : null,
    client_assignee_id: finalAssigneeType === "client" ? client_assignee_id : null,
    start_date: start_date ?? null,
    due_date: due_date ?? null,
    completed_at: finalStatus === "done" ? new Date().toISOString() : null,
    position: count ?? 0,
    created_by: userId,
    source: source ?? "manual",
    source_id: source_id ?? null,
  };

  const { data, error } = await supabaseAdmin.from("tasks").insert(payload).select("*").single();
  if (error) throw error;

  return {
    task: data,
    notifyClientAssigneeId: finalAssigneeType === "client" ? client_assignee_id : null,
  };
}

/**
 * Compute completed_at transition the same way the tasks_before_write DB trigger does,
 * so behavior is correct even if that trigger isn't present.
 */
export function computeCompletedAt(newStatus, oldStatus) {
  if (newStatus === "done" && oldStatus !== "done") return new Date().toISOString();
  if (newStatus !== "done") return null;
  return undefined; // status staying 'done' -> leave completed_at as-is
}

/**
 * Attach assignee_name, subtasks_count and checklist_progress to a list of task rows.
 */
export async function enrichTasks(companyId, tasks) {
  if (!tasks || tasks.length === 0) return [];

  const taskIds = tasks.map((t) => t.id);
  const assigneeIds = [...new Set(tasks.map((t) => t.assignee_id).filter(Boolean))];
  const clientAssigneeIds = [...new Set(tasks.map((t) => t.client_assignee_id).filter(Boolean))];

  const [usersRes, clientUsersRes, subtasksRes, checklistRes] = await Promise.all([
    assigneeIds.length
      ? supabaseAdmin.from("users").select("id, name").in("id", assigneeIds)
      : Promise.resolve({ data: [] }),
    clientAssigneeIds.length
      ? supabaseAdmin.from("client_portal_users").select("id, name").in("id", clientAssigneeIds)
      : Promise.resolve({ data: [] }),
    supabaseAdmin.from("tasks").select("parent_task_id").eq("company_id", companyId).in("parent_task_id", taskIds),
    supabaseAdmin.from("task_checklist_items").select("task_id, is_done").in("task_id", taskIds),
  ]);
  if (usersRes.error) throw usersRes.error;
  if (clientUsersRes.error) throw clientUsersRes.error;
  if (subtasksRes.error) throw subtasksRes.error;
  if (checklistRes.error) throw checklistRes.error;

  const nameById = Object.fromEntries((usersRes.data || []).map((u) => [String(u.id), u.name]));
  const clientNameById = Object.fromEntries((clientUsersRes.data || []).map((u) => [String(u.id), u.name]));

  const subtaskCounts = {};
  (subtasksRes.data || []).forEach((row) => {
    const key = String(row.parent_task_id);
    subtaskCounts[key] = (subtaskCounts[key] || 0) + 1;
  });

  const checklistProgress = {};
  (checklistRes.data || []).forEach((row) => {
    const key = String(row.task_id);
    if (!checklistProgress[key]) checklistProgress[key] = { done: 0, total: 0 };
    checklistProgress[key].total += 1;
    if (row.is_done) checklistProgress[key].done += 1;
  });

  return tasks.map((t) => ({
    ...t,
    assignee_name: t.assignee_id ? nameById[String(t.assignee_id)] ?? null : null,
    client_assignee_name: t.client_assignee_id ? clientNameById[String(t.client_assignee_id)] ?? null : null,
    subtasks_count: subtaskCounts[String(t.id)] || 0,
    checklist_progress: checklistProgress[String(t.id)] || { done: 0, total: 0 },
  }));
}

/**
 * Walk the dependency chain starting at startTaskId (following depends_on_task_id edges).
 * Returns true if targetTaskId is reachable (i.e. adding an edge targetTaskId -> startTaskId
 * would create a cycle).
 */
export async function wouldCreateCircularDependency(startTaskId, targetTaskId) {
  const visited = new Set();
  let queue = [startTaskId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (String(current) === String(targetTaskId)) return true;
    const key = String(current);
    if (visited.has(key)) continue;
    visited.add(key);

    const { data, error } = await supabaseAdmin
      .from("task_dependencies")
      .select("depends_on_task_id")
      .eq("task_id", current);
    if (error) throw error;
    (data || []).forEach((row) => queue.push(row.depends_on_task_id));
  }

  return false;
}
