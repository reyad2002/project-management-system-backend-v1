import { supabaseAdmin } from "../../db_connection.js";
import { addDays, buildTaskReport, countReschedules, daysBetween, previousPeriod } from "../lib/taskReports.js";
import { isDate } from "../lib/taskTemplates.js";

const PAGE = 1000;
const MAX_PAGES = 10;
const MAX_SPAN_DAYS = 366;
const COLUMNS = "id, project_id, assignee_id, status, priority, due_date, created_at, completed_at";

/** Read every row a filtered query matches (PostgREST returns at most 1000 per request). */
async function selectAll(buildQuery) {
  const rows = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await buildQuery().range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

const monthStart = (d) => `${d.slice(0, 7)}-01`;

/**
 * GET /api/tasks/reports?from=&to=  (managers and above)
 * Default period: this month so far. Also returns the period just before it, for comparison.
 */
export async function report(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const today = new Date().toISOString().slice(0, 10);
    const from = req.query.from || monthStart(today);
    const to = req.query.to || today;
    if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: "from and to must be dates (YYYY-MM-DD)" });
    if (from > to) return res.status(400).json({ error: "from must be on or before to" });
    if (daysBetween(from, to) + 1 > MAX_SPAN_DAYS) return res.status(400).json({ error: `Pick a period of at most ${MAX_SPAN_DAYS} days` });

    const before = previousPeriod(from, to);
    const since = `${before.from}T00:00:00Z`;
    const until = `${addDays(to, 1)}T00:00:00Z`;

    // Tasks finished or created in either period, plus everything still open.
    const base = () => supabaseAdmin.from("tasks").select(COLUMNS).eq("company_id", companyId).is("parent_task_id", null).order("id", { ascending: true });
    const [finished, created, open] = await Promise.all([
      selectAll(() => base().gte("completed_at", since).lt("completed_at", until)),
      selectAll(() => base().gte("created_at", since).lt("created_at", until)),
      selectAll(() => base().neq("status", "done")),
    ]);
    const byId = new Map();
    for (const t of [...finished, ...created, ...open]) byId.set(t.id, t);
    const tasks = [...byId.values()];

    const userIds = [...new Set(tasks.map((t) => t.assignee_id).filter(Boolean))];
    const projectIds = [...new Set(tasks.map((t) => t.project_id).filter(Boolean))];
    const [usersRes, projectsRes, auditRes] = await Promise.all([
      userIds.length ? supabaseAdmin.from("users").select("id, name").in("id", userIds) : { data: [], error: null },
      projectIds.length ? supabaseAdmin.from("projects").select("id, title").in("id", projectIds) : { data: [], error: null },
      supabaseAdmin
        .from("audit_logs")
        .select("entity_id, before, after")
        .eq("company_id", companyId)
        .eq("entity_type", "task")
        .eq("action", "update")
        .eq("outcome", "success")
        .gte("occurred_at", `${from}T00:00:00Z`)
        .lt("occurred_at", until)
        .limit(5000),
    ]);
    if (usersRes.error) throw usersRes.error;
    if (projectsRes.error) throw projectsRes.error;
    if (auditRes.error) throw auditRes.error;

    const rescheduled = countReschedules(auditRes.data || []);
    // Names for the "moved most often" list (those tasks may be done, so fetch them directly).
    const hot = rescheduled.sort((a, b) => b.count - a.count).slice(0, 10).map((r) => r.task_id);
    const taskInfo = {};
    if (hot.length) {
      const { data: hotTasks, error: hotError } = await supabaseAdmin.from("tasks").select("id, title, assignee_id, project_id, due_date, status").eq("company_id", companyId).in("id", hot);
      if (hotError) throw hotError;
      const extraUsers = [...new Set((hotTasks || []).map((t) => t.assignee_id).filter(Boolean))].filter((id) => !userIds.includes(id));
      const names = Object.fromEntries((usersRes.data || []).map((u) => [String(u.id), u.name]));
      if (extraUsers.length) {
        const { data: more } = await supabaseAdmin.from("users").select("id, name").in("id", extraUsers);
        for (const u of more || []) names[String(u.id)] = u.name;
      }
      for (const t of hotTasks || []) {
        taskInfo[String(t.id)] = { title: t.title, status: t.status, due_date: t.due_date, assignee_name: t.assignee_id ? names[String(t.assignee_id)] ?? null : null };
      }
    }

    return res.json(
      buildTaskReport({
        tasks,
        from,
        to,
        today,
        users: Object.fromEntries((usersRes.data || []).map((u) => [String(u.id), u.name])),
        projects: Object.fromEntries((projectsRes.data || []).map((p) => [String(p.id), p.title])),
        rescheduled,
        taskInfo,
      }),
    );
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
