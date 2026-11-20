import { supabaseAdmin } from "../../db_connection.js";
import { createNotifications } from "./notifications.js";
import { generateDueRecurringTasks } from "./taskRecurrence.js";
import { sendEmail } from "./email.js";

/**
 * The daily task job (runs with the meeting-reminder cron, see routes/internal.js):
 *  1. create today's recurring tasks
 *  2. "due soon": remind assignees of tasks due today or tomorrow (once per task)
 *  3. "overdue": tell assignees about tasks now past due (once per task)
 *  4. "escalate": tell managers about tasks overdue for ESCALATE_AFTER_DAYS or more (once per task)
 *  5. e-mail each person a short digest (once per day, opt-out per person)
 * Every step is independent: one failing never stops the others.
 */

export const ESCALATE_AFTER_DAYS = 3;
const MANAGER_ROLES = ["owner", "admin", "manager"];
const MAX_PER_RUN = 1000;

const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays = (s, n) => new Date(new Date(`${s}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);

async function openAssignedTasks(extra) {
  let q = supabaseAdmin
    .from("tasks")
    .select("id, company_id, title, due_date, assignee_id, project_id, escalated_at")
    .neq("status", "done")
    .eq("assignee_type", "team_member")
    .not("assignee_id", "is", null)
    .limit(MAX_PER_RUN);
  q = extra(q);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

/** Of these tasks, the ones that have no notification of `type` yet. */
async function withoutNotification(tasks, type) {
  if (tasks.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from("notifications")
    .select("related_id")
    .eq("type", type)
    .eq("related_type", "task")
    .in("related_id", tasks.map((t) => t.id));
  if (error) throw error;
  const done = new Set((data || []).map((n) => String(n.related_id)));
  return tasks.filter((t) => !done.has(String(t.id)));
}

async function notifyAssignees(tasks, type, title, body) {
  if (tasks.length === 0) return [];
  await createNotifications(
    tasks.map((t) => ({
      company_id: t.company_id,
      recipient_type: "team_member",
      recipient_id: t.assignee_id,
      type,
      title: title(t),
      body: body(t),
      related_type: "task",
      related_id: t.id,
    })),
  );
  return tasks.map((t) => t.id);
}

export async function flagDueSoon(today = todayStr()) {
  const tasks = await openAssignedTasks((q) => q.gte("due_date", today).lte("due_date", addDays(today, 1)));
  const fresh = await withoutNotification(tasks, "task_due_soon");
  const ids = await notifyAssignees(
    fresh,
    "task_due_soon",
    (t) => (t.due_date === today ? `Due today: ${t.title}` : `Due tomorrow: ${t.title}`),
    (t) => `Due ${t.due_date}`,
  );
  return { notifiedTaskIds: ids };
}

export async function flagOverdueTasks(today = todayStr()) {
  const tasks = await openAssignedTasks((q) => q.lt("due_date", today));
  const fresh = await withoutNotification(tasks, "task_overdue");
  const ids = await notifyAssignees(
    fresh,
    "task_overdue",
    (t) => `Overdue: ${t.title}`,
    (t) => `Was due ${t.due_date}`,
  );
  return { notifiedTaskIds: ids };
}

/** One notification per manager per company summarising the tasks that just crossed the threshold. */
export async function escalateLongOverdue(today = todayStr()) {
  const cutoff = addDays(today, -ESCALATE_AFTER_DAYS);
  const tasks = (await openAssignedTasks((q) => q.lte("due_date", cutoff))).filter((t) => !t.escalated_at);
  if (tasks.length === 0) return { escalatedTaskIds: [] };

  const byCompany = new Map();
  for (const t of tasks) (byCompany.get(t.company_id) ?? byCompany.set(t.company_id, []).get(t.company_id)).push(t);

  const { data: managers, error } = await supabaseAdmin
    .from("users")
    .select("id, company_id, role, status")
    .in("company_id", [...byCompany.keys()])
    .in("role", MANAGER_ROLES);
  if (error) throw error;

  const rows = [];
  for (const [companyId, list] of byCompany) {
    const sample = list.slice(0, 3).map((t) => t.title).join(", ");
    const title = list.length === 1 ? `A task is ${ESCALATE_AFTER_DAYS}+ days overdue` : `${list.length} tasks are ${ESCALATE_AFTER_DAYS}+ days overdue`;
    const body = list.length > 3 ? `${sample} and ${list.length - 3} more` : sample;
    for (const m of (managers || []).filter((u) => String(u.company_id) === String(companyId) && u.status !== "blocked" && u.status !== "inactive")) {
      rows.push({ company_id: companyId, recipient_type: "team_member", recipient_id: m.id, type: "task_escalated", title, body, related_type: null, related_id: null });
    }
  }
  if (rows.length) await createNotifications(rows);

  const ids = tasks.map((t) => t.id);
  const { error: markError } = await supabaseAdmin.from("tasks").update({ escalated_at: new Date().toISOString() }).in("id", ids);
  if (markError) throw markError;
  return { escalatedTaskIds: ids };
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Build one person's digest, or null when there is nothing to say. Pure. */
export function buildDigest(name, tasks, today) {
  const tomorrow = addDays(today, 1);
  const overdue = tasks.filter((t) => t.due_date < today);
  const dueToday = tasks.filter((t) => t.due_date === today);
  const dueTomorrow = tasks.filter((t) => t.due_date === tomorrow);
  if (overdue.length + dueToday.length + dueTomorrow.length === 0) return null;

  const section = (label, list) => (list.length ? { label, titles: list.slice(0, 10).map((t) => t.title), more: Math.max(0, list.length - 10) } : null);
  const sections = [section("Overdue", overdue), section("Due today", dueToday), section("Due tomorrow", dueTomorrow)].filter(Boolean);

  const subject = `Your tasks: ${[overdue.length && `${overdue.length} overdue`, dueToday.length && `${dueToday.length} due today`, dueTomorrow.length && `${dueTomorrow.length} due tomorrow`].filter(Boolean).join(", ")}`;
  const text = [`Hi ${name},`, "", ...sections.flatMap((s) => [`${s.label}:`, ...s.titles.map((t) => `  - ${t}`), ...(s.more ? [`  ...and ${s.more} more`] : []), ""])].join("\n");
  const html =
    `<p>Hi ${escapeHtml(name)},</p>` +
    sections.map((s) => `<p><strong>${s.label}</strong></p><ul>${s.titles.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}${s.more ? `<li>...and ${s.more} more</li>` : ""}</ul>`).join("");
  return { subject, text, html };
}

export async function sendDailyDigests(today = todayStr()) {
  const tomorrow = addDays(today, 1);
  const tasks = await openAssignedTasks((q) => q.lte("due_date", tomorrow));
  if (tasks.length === 0) return { sent: 0 };

  const byUser = new Map();
  for (const t of tasks) (byUser.get(String(t.assignee_id)) ?? byUser.set(String(t.assignee_id), []).get(String(t.assignee_id))).push(t);

  const { data: users, error } = await supabaseAdmin
    .from("users")
    .select("id, name, email, status, task_digest_enabled")
    .in("id", [...byUser.keys()]);
  if (error) throw error;

  let sent = 0;
  for (const u of users || []) {
    if (!u.email || !u.task_digest_enabled || u.status === "blocked" || u.status === "inactive") continue;
    const digest = buildDigest(u.name, byUser.get(String(u.id)) || [], today);
    if (!digest) continue;

    // Claim today's digest first: the unique key makes a second run (or a retry) skip this person.
    const { error: claimError } = await supabaseAdmin.from("task_digest_log").insert({ user_id: u.id, digest_date: today });
    if (claimError) {
      if (claimError.code === "23505") continue;
      throw claimError;
    }
    try {
      await sendEmail({ to: u.email, subject: digest.subject, html: digest.html, text: digest.text });
      sent += 1;
    } catch (err) {
      console.error(`[task-digest] failed to email user ${u.id}:`, err.message);
    }
  }
  return { sent };
}

async function step(name, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`[task-reminders] ${name} failed:`, err.message);
    return { error: err.message };
  }
}

export async function runTaskReminderJob() {
  const generated = await step("recurring", () => generateDueRecurringTasks());
  const dueSoon = await step("due-soon", () => flagDueSoon());
  const overdue = await step("overdue", () => flagOverdueTasks());
  const escalated = await step("escalation", () => escalateLongOverdue());
  const digests = await step("digest", () => sendDailyDigests());
  return {
    generatedTaskIds: Array.isArray(generated) ? generated.map((t) => t.id) : [],
    notifiedTaskIds: overdue.notifiedTaskIds ?? [],
    dueSoonTaskIds: dueSoon.notifiedTaskIds ?? [],
    escalatedTaskIds: escalated.escalatedTaskIds ?? [],
    digestsSent: digests.sent ?? 0,
    errors: [["recurring", generated], ["due-soon", dueSoon], ["overdue", overdue], ["escalation", escalated], ["digest", digests]]
      .filter(([, r]) => r && !Array.isArray(r) && r.error)
      .map(([name, r]) => `${name}: ${r.error}`),
  };
}
