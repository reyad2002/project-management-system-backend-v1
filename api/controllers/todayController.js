import { supabaseAdmin } from "../../db_connection.js";
import { ACCESS } from "../middleware/auth.js";
import { canSeeAllTasks } from "../lib/tasks.js";
import { loadClientHealth } from "../lib/clientHealth.js";
import { loadBudgets } from "../lib/budgets.js";

const ITEMS = 5;
const round2 = (n) => Math.round(n * 100) / 100;
const sum = (rows, field) => round2(rows.reduce((s, r) => s + Number(r[field] ?? 0), 0));

/** Today's date in Cairo (YYYY-MM-DD): "today" for the team, not for the server's UTC clock. */
export function cairoDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The Cairo calendar day and clock time of a timestamp. */
export function cairoParts(ts) {
  const d = new Date(ts);
  const date = cairoDate(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return { date, time };
}

const dayShift = (date, n) => new Date(new Date(`${date}T12:00:00Z`).getTime() + n * 86_400_000).toISOString();

/** Clients to look after and projects close to (or over) their budget: the top few of each. */
async function attention(companyId) {
  try {
    const [health, budgets] = await Promise.all([loadClientHealth(companyId), loadBudgets(companyId)]);
    return {
      clients: health.clients
        .filter((c) => c.level !== "healthy")
        .slice(0, 3)
        .map((c) => ({ client_id: c.client_id, name: c.name, score: c.score, level: c.level, reason: c.reasons.find((r) => r.severity === "bad")?.text ?? null })),
      budgets: budgets
        .filter((p) => p.level !== "ok")
        .slice(0, 3)
        .map((p) => ({ id: p.id, title: p.title, percent: p.percent, level: p.level, budget: p.budget, actual: p.actual })),
    };
  } catch (err) {
    console.error("[today] attention failed:", err.message);
    return { clients: [], budgets: [] };
  }
}

async function rows(promise, label) {
  const { data, error } = await promise;
  if (error) {
    console.error(`[today] ${label} failed:`, error.message);
    return null;
  }
  return data || [];
}

/**
 * GET /api/today — the owner's morning screen in one request: money in / out today, what to collect,
 * what to pay, late tasks and today's meetings. Money sections are only for finance roles; tasks show
 * everyone's for managers and above, otherwise just the caller's.
 */
export async function today(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const day = cairoDate();
    const finance = ACCESS.finance.includes(req.user.role);
    const seeAll = canSeeAllTasks(req.user);

    let tasksQuery = supabaseAdmin
      .from("tasks")
      .select("id, title, due_date, status, priority, assignee_id, project_id")
      .eq("company_id", companyId)
      .neq("status", "done")
      .is("parent_task_id", null)
      .or(`due_date.lte.${day},status.eq.blocked`)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(500);
    if (!seeAll) tasksQuery = tasksQuery.eq("assignee_id", req.user.id);

    const meetingsQuery = supabaseAdmin
      .from("meetings")
      .select("id, title, scheduled_at, project_id, meeting_link")
      .eq("company_id", companyId)
      .eq("status", "scheduled")
      .gte("scheduled_at", dayShift(day, -1))
      .lte("scheduled_at", dayShift(day, 2));

    const money = finance
      ? {
          payments: supabaseAdmin.from("payments").select("id, amount, project_id, payment_method").eq("company_id", companyId).eq("payment_date", day),
          expenses: supabaseAdmin.from("expenses").select("id, title, amount, type, cost_category, project_id").eq("company_id", companyId).eq("expense_date", day),
          receivables: supabaseAdmin.from("v_ar_aging").select("id, invoice_number, client_name, due_date, remaining_amount, days_overdue").eq("company_id", companyId).gt("remaining_amount", 0).lte("due_date", day).order("due_date", { ascending: true }).limit(500),
          payables: supabaseAdmin.from("v_ap_aging").select("id, bill_number, vendor_name, due_date, remaining_amount, days_overdue").eq("company_id", companyId).gt("remaining_amount", 0).lte("due_date", day).order("due_date", { ascending: true }).limit(500),
          subscriptions: supabaseAdmin.from("recurring_expenses").select("id, name, amount, next_due_date, auto_charge").eq("company_id", companyId).eq("status", "active").eq("auto_charge", false).lte("next_due_date", day),
          renewals: supabaseAdmin.from("recurring_revenue").select("id, type, amount, next_renewal_date, client_id, project_id").eq("company_id", companyId).eq("status", "active").lte("next_renewal_date", day),
          testProjects: supabaseAdmin.from("projects").select("id").eq("company_id", companyId).eq("is_test", true),
          projects: supabaseAdmin.from("projects").select("id, title").eq("company_id", companyId),
        }
      : null;

    const [tasks, meetings, ...moneyRows] = await Promise.all([
      rows(tasksQuery, "tasks"),
      rows(meetingsQuery, "meetings"),
      ...(money ? Object.entries(money).map(([k, q]) => rows(q, k)) : []),
    ]);

    const result = { date: day, role: req.user.role, tasks: null, meetings: null, money: null, attention: null };

    // ---- tasks
    if (tasks) {
      const open = tasks;
      const overdue = open.filter((t) => t.due_date && t.due_date < day);
      const dueToday = open.filter((t) => t.due_date === day);
      const blocked = open.filter((t) => t.status === "blocked");
      const ids = [...new Set([...overdue, ...dueToday, ...blocked].map((t) => t.assignee_id).filter(Boolean))];
      const { data: people } = ids.length ? await supabaseAdmin.from("users").select("id, name").in("id", ids) : { data: [] };
      const nameOf = Object.fromEntries((people || []).map((u) => [String(u.id), u.name]));
      const view = (t) => ({ id: t.id, title: t.title, due_date: t.due_date, status: t.status, priority: t.priority, assignee_name: t.assignee_id ? nameOf[String(t.assignee_id)] ?? null : null });
      result.tasks = {
        scope: seeAll ? "all" : "mine",
        overdueCount: overdue.length,
        dueTodayCount: dueToday.length,
        blockedCount: blocked.length,
        overdue: overdue.slice(0, ITEMS).map(view),
        dueToday: dueToday.slice(0, ITEMS).map(view),
      };
    }

    // ---- meetings (the team's day, not the server's)
    if (meetings) {
      result.meetings = meetings
        .map((m) => ({ ...m, ...cairoParts(m.scheduled_at) }))
        .filter((m) => m.date === day)
        .sort((a, b) => a.time.localeCompare(b.time))
        .map((m) => ({ id: m.id, title: m.title, time: m.time, project_id: m.project_id, meeting_link: m.meeting_link }));
    }

    // ---- money
    if (money) {
      const keys = Object.keys(money);
      const m = Object.fromEntries(keys.map((k, i) => [k, moneyRows[i]]));
      const testIds = new Set((m.testProjects || []).map((p) => String(p.id)));
      const projectTitle = Object.fromEntries((m.projects || []).map((p) => [String(p.id), p.title]));
      const live = (r) => !r.project_id || !testIds.has(String(r.project_id)); // test projects never count

      const paymentsIn = (m.payments || []).filter(live);
      const spent = (m.expenses || []).filter(live);
      const overdueInvoices = (m.receivables || []).filter((r) => r.due_date < day);
      const dueTodayInvoices = (m.receivables || []).filter((r) => r.due_date === day);
      const billsDue = m.payables || [];

      result.money = {
        in: {
          total: sum(paymentsIn, "amount"),
          count: paymentsIn.length,
          items: paymentsIn.slice(0, ITEMS).map((p) => ({ id: p.id, amount: Number(p.amount), project_title: p.project_id ? projectTitle[String(p.project_id)] ?? null : null, method: p.payment_method })),
          expectedToday: { total: sum(dueTodayInvoices, "remaining_amount"), count: dueTodayInvoices.length },
          renewalsDue: { total: sum(m.renewals || [], "amount"), count: (m.renewals || []).length },
        },
        out: {
          total: sum(spent, "amount"),
          count: spent.length,
          items: spent.slice(0, ITEMS).map((e) => ({ id: e.id, title: e.title, amount: Number(e.amount), category: e.cost_category })),
          billsDue: { total: sum(billsDue, "remaining_amount"), count: billsDue.length, items: billsDue.slice(0, ITEMS).map((b) => ({ id: b.id, bill_number: b.bill_number, vendor_name: b.vendor_name, due_date: b.due_date, remaining_amount: Number(b.remaining_amount), days_overdue: b.days_overdue })) },
          subscriptionsDue: { total: sum(m.subscriptions || [], "amount"), count: (m.subscriptions || []).length, items: (m.subscriptions || []).slice(0, ITEMS).map((s) => ({ id: s.id, name: s.name, amount: Number(s.amount), next_due_date: s.next_due_date })) },
        },
        collect: {
          overdueTotal: sum(overdueInvoices, "remaining_amount"),
          overdueCount: overdueInvoices.length,
          // oldest first: those are the ones to chase today
          items: overdueInvoices.slice(0, ITEMS).map((r) => ({ id: r.id, invoice_number: r.invoice_number, client_name: r.client_name, due_date: r.due_date, remaining_amount: Number(r.remaining_amount), days_overdue: r.days_overdue })),
        },
      };
    }

    if (finance) result.attention = await attention(companyId);

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
