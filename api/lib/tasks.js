import { supabaseAdmin } from "../../db_connection.js";

export const taskStatuses = ["todo", "in_progress", "in_review", "done", "blocked"];
export const taskPriorities = ["low", "medium", "high", "urgent"];
export const projectMemberRoles = ["owner", "manager", "contributor", "viewer"];

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

  const [usersRes, subtasksRes, checklistRes] = await Promise.all([
    assigneeIds.length
      ? supabaseAdmin.from("users").select("id, name").in("id", assigneeIds)
      : Promise.resolve({ data: [] }),
    supabaseAdmin.from("tasks").select("parent_task_id").eq("company_id", companyId).in("parent_task_id", taskIds),
    supabaseAdmin.from("task_checklist_items").select("task_id, is_done").in("task_id", taskIds),
  ]);
  if (usersRes.error) throw usersRes.error;
  if (subtasksRes.error) throw subtasksRes.error;
  if (checklistRes.error) throw checklistRes.error;

  const nameById = Object.fromEntries((usersRes.data || []).map((u) => [String(u.id), u.name]));

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
