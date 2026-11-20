import { supabaseAdmin } from "../../db_connection.js";
import { getProjectForCompany, taskPriorities, validateUserInCompany } from "../lib/tasks.js";
import { FREQUENCIES, describeRule, occurrenceOnOrAfter, todayStr } from "../lib/taskRecurrence.js";
import { isDate, normalizeChecklist } from "../lib/taskTemplates.js";

const table = "recurring_tasks";
const STATUSES = ["active", "paused"];

const maxDate = (a, b) => (a > b ? a : b);

/** Attach project / assignee names and a readable schedule. */
async function decorate(companyId, rules) {
  if (!rules.length) return [];
  const projectIds = [...new Set(rules.map((r) => r.project_id).filter(Boolean))];
  const userIds = [...new Set(rules.map((r) => r.assignee_id).filter(Boolean))];
  const [projects, users] = await Promise.all([
    projectIds.length ? supabaseAdmin.from("projects").select("id, title").in("id", projectIds) : { data: [] },
    userIds.length ? supabaseAdmin.from("users").select("id, name").in("id", userIds) : { data: [] },
  ]);
  if (projects.error) throw projects.error;
  if (users.error) throw users.error;
  const projectTitle = Object.fromEntries((projects.data || []).map((p) => [String(p.id), p.title]));
  const userName = Object.fromEntries((users.data || []).map((u) => [String(u.id), u.name]));
  return rules.map((r) => ({
    ...r,
    schedule: describeRule(r),
    project_title: r.project_id ? projectTitle[String(r.project_id)] ?? null : null,
    assignee_name: r.assignee_id ? userName[String(r.assignee_id)] ?? null : null,
    ended: !!r.end_date && r.next_run_date > r.end_date,
  }));
}

/**
 * Validate a full rule (existing values merged with the request). Returns { error } or { value } where
 * value holds only the columns that belong in the table.
 */
async function normalize(companyId, input) {
  const title = String(input.title ?? "").trim();
  if (!title) return { error: "title is required" };
  if (title.length > 200) return { error: "title is too long (max 200)" };

  const priority = input.priority ?? "medium";
  if (!taskPriorities.includes(priority)) return { error: "Invalid priority" };

  const frequency = input.frequency;
  if (!FREQUENCIES.includes(frequency)) return { error: "frequency must be daily, weekly or monthly" };

  let weekday = null;
  let dayOfMonth = null;
  if (frequency === "weekly") {
    weekday = Number(input.weekday);
    if (input.weekday === null || input.weekday === undefined || input.weekday === "" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return { error: "Choose the weekday (0 = Sunday ... 6 = Saturday)" };
    }
  }
  if (frequency === "monthly") {
    dayOfMonth = Number(input.day_of_month);
    if (input.day_of_month === null || input.day_of_month === undefined || input.day_of_month === "" || !Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31) {
      return { error: "Choose the day of the month (1-31; 31 = the last day of shorter months)" };
    }
  }

  const dueIn = input.due_in_days === undefined || input.due_in_days === "" || input.due_in_days === null ? 0 : Number(input.due_in_days);
  if (!Number.isInteger(dueIn) || dueIn < 0 || dueIn > 365) return { error: "Due after must be a whole number of days from 0 to 365" };

  const startDate = input.start_date || todayStr();
  if (!isDate(startDate)) return { error: "start_date must be a date (YYYY-MM-DD)" };
  const endDate = input.end_date || null;
  if (endDate && !isDate(endDate)) return { error: "end_date must be a date (YYYY-MM-DD)" };
  if (endDate && endDate < startDate) return { error: "end_date must be on or after the start date" };

  const status = input.status ?? "active";
  if (!STATUSES.includes(status)) return { error: "Invalid status" };

  const checklist = normalizeChecklist(input.checklist);
  if (checklist.error) return { error: checklist.error };

  let projectId = null;
  if (input.project_id !== null && input.project_id !== undefined && input.project_id !== "") {
    const project = await getProjectForCompany(companyId, input.project_id, "id");
    if (!project) return { error: "Project not found" };
    projectId = project.id;
  }

  let assigneeId = null;
  if (input.assignee_id !== null && input.assignee_id !== undefined && input.assignee_id !== "") {
    if (!(await validateUserInCompany(companyId, input.assignee_id))) return { error: "Invalid assignee_id for this company" };
    assigneeId = input.assignee_id;
  }

  return {
    value: {
      title,
      description: input.description ? String(input.description).trim().slice(0, 1000) : null,
      priority,
      project_id: projectId,
      assignee_id: assigneeId,
      frequency,
      weekday,
      day_of_month: dayOfMonth,
      due_in_days: dueIn,
      checklist: checklist.value,
      start_date: startDate,
      end_date: endDate,
      status,
    },
  };
}

const firstRun = (rule) => occurrenceOnOrAfter(rule, maxDate(todayStr(), rule.start_date));

export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("company_id", companyId)
      .order("status", { ascending: true })
      .order("next_run_date", { ascending: true });
    if (error) throw error;
    return res.json({ recurringTasks: await decorate(companyId, data || []) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    const parsed = await normalize(companyId, req.body ?? {});
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert({ ...parsed.value, company_id: companyId, created_by: req.user.id, next_run_date: firstRun(parsed.value) })
      .select("*")
      .single();
    if (error) throw error;
    const [decorated] = await decorate(companyId, [data]);
    return res.status(201).json(decorated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data: existing, error: findError } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", req.params.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (findError) throw findError;
    if (!existing) return res.status(404).json({ error: "Not found" });

    const parsed = await normalize(companyId, { ...existing, ...req.body });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const value = parsed.value;

    // Changing the schedule, or resuming after a pause, restarts from today: a pause must not backfill.
    const scheduleChanged =
      value.frequency !== existing.frequency ||
      value.weekday !== existing.weekday ||
      value.day_of_month !== existing.day_of_month ||
      value.start_date !== existing.start_date;
    const resumed = existing.status === "paused" && value.status === "active";
    const patch = { ...value, updated_at: new Date().toISOString() };
    if (scheduleChanged || resumed) patch.next_run_date = firstRun(value);

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(patch)
      .eq("id", existing.id)
      .eq("company_id", companyId)
      .select("*")
      .single();
    if (error) throw error;
    const [decorated] = await decorate(companyId, [data]);
    return res.json(decorated);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function remove(req, res) {
  try {
    const companyId = req.user?.company_id;
    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("id", req.params.id)
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
