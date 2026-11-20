import { supabaseAdmin } from "../../db_connection.js";
import { createNotification } from "./notifications.js";

/**
 * Recurring tasks: a rule (daily / weekly on a weekday / monthly on a day) that creates a fresh task
 * on each occurrence. Dates are YYYY-MM-DD strings handled in UTC, the same as the rest of the app.
 *
 * Generation is idempotent: tasks carry (recurring_task_id, recurrence_date), unique in the database,
 * so an occurrence can never be created twice however often the generator runs or races.
 * It runs from the daily cron AND whenever the task list / summary is opened (throttled), so tasks
 * appear on time even if the cron isn't scheduled.
 */

export const FREQUENCIES = ["daily", "weekly", "monthly"];

const DAY_MS = 86_400_000;
const parse = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);

export const todayStr = () => new Date().toISOString().slice(0, 10);

export function addDays(dateStr, n) {
  return fmt(new Date(parse(dateStr).getTime() + n * DAY_MS));
}

/** The day `dom` of the given month, clamped to the month's length (31 -> the 30th in April, 28th/29th in Feb). */
function clampedDay(year, month0, dom) {
  const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return fmt(new Date(Date.UTC(year, month0, Math.min(dom, last))));
}

/** First occurrence of the rule on or after `fromDate`. rule = { frequency, weekday, day_of_month }. */
export function occurrenceOnOrAfter(rule, fromDate) {
  if (rule.frequency === "weekly") {
    const diff = (Number(rule.weekday) - parse(fromDate).getUTCDay() + 7) % 7;
    return addDays(fromDate, diff);
  }
  if (rule.frequency === "monthly") {
    const d = parse(fromDate);
    const candidate = clampedDay(d.getUTCFullYear(), d.getUTCMonth(), Number(rule.day_of_month));
    if (candidate >= fromDate) return candidate;
    return clampedDay(d.getUTCFullYear(), d.getUTCMonth() + 1, Number(rule.day_of_month));
  }
  return fromDate; // daily
}

/** First occurrence strictly after `afterDate`. */
export function nextOccurrence(rule, afterDate) {
  return occurrenceOnOrAfter(rule, addDays(afterDate, 1));
}

/** Human description, e.g. "Every month on day 5", "Every Sunday", "Every day". */
export function describeRule(rule) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (rule.frequency === "weekly") return `Every ${days[rule.weekday] ?? "week"}`;
  if (rule.frequency === "monthly") return Number(rule.day_of_month) >= 31 ? "Every month on the last day" : `Every month on day ${rule.day_of_month}`;
  return "Every day";
}

/**
 * Occurrences from `firstRun` up to and including `today` (stopping at `endDate`), plus the first
 * occurrence after that. A long outage must not bury people in stale tasks, so only the most recent
 * `keep` missed occurrences are returned for creation.
 */
export function dueOccurrences(rule, firstRun, today, { endDate = null, keep = 3, limit = 800 } = {}) {
  const all = [];
  let run = firstRun;
  for (let i = 0; i < limit && run <= today && (!endDate || run <= endDate); i += 1) {
    all.push(run);
    run = nextOccurrence(rule, run);
  }
  return { toCreate: all.slice(-keep), lastConsidered: all.at(-1) ?? null, next: run };
}

const MAX_RULES_PER_RUN = 200;
const lastRun = new Map();
export function clearRecurringTaskThrottle() {
  lastRun.clear();
}

/**
 * Create the tasks that fell due. `throttleMs` lets page-open callers skip the work if this server
 * instance already ran it a moment ago (nothing new falls due within minutes).
 * @returns the created tasks
 */
export async function generateDueRecurringTasks({ companyId, throttleMs = 0 } = {}) {
  const today = todayStr();

  if (throttleMs > 0) {
    const key = `${companyId ?? "all"}:${today}`;
    const at = lastRun.get(key);
    if (at && Date.now() - at < throttleMs) return [];
    if (lastRun.size > 200) lastRun.clear();
    lastRun.set(key, Date.now());
  }

  let query = supabaseAdmin
    .from("recurring_tasks")
    .select("*")
    .eq("status", "active")
    .lte("next_run_date", today)
    .limit(MAX_RULES_PER_RUN);
  if (companyId) query = query.eq("company_id", companyId);
  const { data: rules, error } = await query;
  if (error) throw error;

  const created = [];
  for (const rule of rules || []) {
    const { toCreate, lastConsidered, next } = dueOccurrences(rule, rule.next_run_date, today, { endDate: rule.end_date });

    for (const run of toCreate) {
      const { data: task, error: insertError } = await supabaseAdmin
        .from("tasks")
        .insert({
          company_id: rule.company_id,
          project_id: rule.project_id,
          title: rule.title,
          description: rule.description,
          status: "todo",
          priority: rule.priority,
          assignee_type: "team_member",
          assignee_id: rule.assignee_id,
          due_date: addDays(run, rule.due_in_days ?? 0),
          position: 0,
          created_by: rule.created_by,
          source: "manual",
          recurring_task_id: rule.id,
          recurrence_date: run,
        })
        .select("*")
        .single();
      // 23505 = this occurrence already exists (another run got there first).
      if (insertError) {
        if (insertError.code === "23505") continue;
        throw insertError;
      }
      created.push(task);

      const items = Array.isArray(rule.checklist) ? rule.checklist : [];
      if (items.length > 0) {
        const { error: checklistError } = await supabaseAdmin
          .from("task_checklist_items")
          .insert(items.map((title, position) => ({ task_id: task.id, title: String(title), position, is_done: false })));
        if (checklistError) console.error("[recurring-tasks] checklist failed:", checklistError.message);
      }

      if (rule.assignee_id) {
        try {
          await createNotification({
            company_id: rule.company_id,
            recipient_type: "team_member",
            recipient_id: rule.assignee_id,
            type: "task_assigned",
            title: `New recurring task: ${rule.title}`,
            body: task.due_date ? `Due ${task.due_date}` : null,
            related_type: "task",
            related_id: task.id,
          });
        } catch (notifyError) {
          console.error("[recurring-tasks] notification failed:", notifyError.message);
        }
      }
    }

    // Move the rule forward only if nobody else did meanwhile (optimistic concurrency on next_run_date).
    const { error: updateError } = await supabaseAdmin
      .from("recurring_tasks")
      .update({
        next_run_date: next,
        ...(lastConsidered ? { last_run_date: lastConsidered } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", rule.id)
      .eq("next_run_date", rule.next_run_date);
    if (updateError) throw updateError;
  }

  return created;
}
