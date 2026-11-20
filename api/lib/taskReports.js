/**
 * Team task report: how the work is going over a period, compared with the period before it.
 * Pure functions over plain rows so the numbers can be checked without a database.
 *
 * Definitions (stated on the page too):
 *  - created / completed: tasks whose created_at / completed_at falls in the period (UTC dates)
 *  - on time: completed on or before its due date (only tasks that had a due date count)
 *  - average days: created_at -> completed_at, over the tasks completed in the period
 *  - overdue: still open and past its due date today
 */

const DAY_MS = 86_400_000;
const parse = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
const dateOf = (ts) => (ts ? String(ts).slice(0, 10) : null);
const round1 = (n) => Math.round(n * 10) / 10;

export function addDays(s, n) {
  return fmt(new Date(parse(s).getTime() + n * DAY_MS));
}

export function daysBetween(a, b) {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / DAY_MS);
}

/** The period right before [from, to] with the same length. */
export function previousPeriod(from, to) {
  const length = daysBetween(from, to) + 1;
  return { from: addDays(from, -length), to: addDays(from, -1) };
}

const inPeriod = (date, p) => !!date && date >= p.from && date <= p.to;

/** created / completed / on-time rate / average days for one period. */
export function periodStats(tasks, period) {
  const completed = tasks.filter((t) => inPeriod(dateOf(t.completed_at), period));
  const withDue = completed.filter((t) => t.due_date);
  const onTime = withDue.filter((t) => dateOf(t.completed_at) <= t.due_date);
  const spans = completed.filter((t) => t.created_at).map((t) => Math.max(0, (new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()) / DAY_MS));
  return {
    created: tasks.filter((t) => inPeriod(dateOf(t.created_at), period)).length,
    completed: completed.length,
    onTimeRate: withDue.length ? Math.round((onTime.length / withDue.length) * 100) : null,
    avgDays: spans.length ? round1(spans.reduce((s, n) => s + n, 0) / spans.length) : null,
  };
}

/**
 * @param tasks    every task relevant to the period or the previous one, plus all open tasks
 * @param users    { [id]: name }
 * @param projects { [id]: title }
 * @param rescheduled [{ task_id, count }] how many times a due date was moved (from the audit log)
 */
export function buildTaskReport({ tasks, from, to, today, users = {}, projects = {}, rescheduled = [], taskInfo = {} }) {
  const period = { from, to };
  const previous = previousPeriod(from, to);
  const open = tasks.filter((t) => t.status !== "done");
  const isOverdue = (t) => !!t.due_date && t.due_date < today;

  const people = new Map();
  const personOf = (id) => {
    const key = id == null ? "none" : String(id);
    if (!people.has(key)) people.set(key, { user_id: id ?? null, name: id == null ? "Unassigned" : users[String(id)] ?? "Unknown", rows: [] });
    return people.get(key);
  };
  for (const t of tasks) personOf(t.assignee_id).rows.push(t);

  const peopleRows = [...people.values()]
    .map(({ user_id, name, rows }) => {
      const stats = periodStats(rows, period);
      const mine = rows.filter((t) => t.status !== "done");
      return {
        user_id,
        name,
        open: mine.length,
        overdue: mine.filter(isOverdue).length,
        blocked: mine.filter((t) => t.status === "blocked").length,
        completed: stats.completed,
        onTimeRate: stats.onTimeRate,
        avgDays: stats.avgDays,
      };
    })
    .filter((p) => p.open > 0 || p.completed > 0)
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name));

  const byProject = new Map();
  for (const t of tasks) {
    const key = t.project_id == null ? "internal" : String(t.project_id);
    if (!byProject.has(key)) byProject.set(key, { project_id: t.project_id ?? null, title: t.project_id == null ? "Internal" : projects[String(t.project_id)] ?? "Unknown project", rows: [] });
    byProject.get(key).rows.push(t);
  }
  const projectRows = [...byProject.values()]
    .map(({ project_id, title, rows }) => {
      const stats = periodStats(rows, period);
      const live = rows.filter((t) => t.status !== "done");
      return { project_id, title, open: live.length, overdue: live.filter(isOverdue).length, completed: stats.completed };
    })
    .filter((p) => p.open > 0 || p.completed > 0)
    .sort((a, b) => b.overdue - a.overdue || b.open - a.open);

  const rescheduledRows = [...rescheduled]
    .filter((r) => r.count >= 1 && taskInfo[String(r.task_id)])
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((r) => ({ task_id: r.task_id, count: r.count, ...taskInfo[String(r.task_id)] }));

  return {
    period,
    previous,
    current: periodStats(tasks, period),
    before: periodStats(tasks, previous),
    snapshot: { open: open.length, overdue: open.filter(isOverdue).length, blocked: open.filter((t) => t.status === "blocked").length },
    people: peopleRows,
    projects: projectRows,
    rescheduled: rescheduledRows,
  };
}

/** Count due-date changes per task from audit entries ({ entity_id, before, after }). */
export function countReschedules(entries) {
  const counts = new Map();
  for (const e of entries) {
    const was = e.before?.due_date;
    const now = e.after?.due_date;
    if (was && now && was !== now && now > was) {
      const key = String(e.entity_id);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([task_id, count]) => ({ task_id, count }));
}
