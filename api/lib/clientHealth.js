import { supabaseAdmin } from "../../db_connection.js";
import { daysBetween, round2, selectAll, testProjectIds, todayStr } from "./db.js";

/**
 * A simple, explainable health score per client (100 = fine). It starts at 100 and loses points for the
 * warning signs below; every deduction is listed in `reasons`, so nobody has to trust a black box.
 *
 *   overdue invoices           -15 (oldest over 60 days: -35, over 30: -25), -10 more with 3+ overdue
 *   active projects past due   -10 each, at most -20
 *   no contact                 -5 after 14 days, -10 after 30, -20 after 60, -30 after 90
 *   a renewal that lapsed      -15 each, at most -30
 *   no active work at all      -15 (no active project, no recurring revenue, nothing paid for 90+ days)
 *
 * 75+ healthy, 50-74 needs a look ("watch"), under 50 "at risk". Upcoming renewals are listed as good news.
 * "Contact" = a call/message logged on the client, or a meeting that already happened on one of its projects.
 */
export const LEVELS = { healthy: 75, watch: 50 };
const NEW_CLIENT_GRACE_DAYS = 14;

export function levelOf(score) {
  return score >= LEVELS.healthy ? "healthy" : score >= LEVELS.watch ? "watch" : "at_risk";
}

/**
 * @param s {
 *   today, clientCreatedAt, lastContactAt, lastPaymentDate,
 *   overdueInvoices: [{ remaining, daysOverdue }], pastDueProjects, activeProjects,
 *   lapsedRenewals, renewalsSoon: [{ inDays, amount }], hasRecurring
 * }
 */
export function scoreClient(s) {
  let score = 100;
  const reasons = [];
  const lose = (points, code, text, extra = {}) => {
    score -= points;
    reasons.push({ code, severity: "bad", points, text, ...extra });
  };

  const overdue = s.overdueInvoices ?? [];
  if (overdue.length > 0) {
    const oldest = Math.max(...overdue.map((i) => i.daysOverdue));
    const total = round2(overdue.reduce((sum, i) => sum + Number(i.remaining), 0));
    let points = oldest > 60 ? 35 : oldest > 30 ? 25 : 15;
    if (overdue.length >= 3) points += 10;
    lose(points, "overdue_invoices", `${overdue.length} overdue invoice${overdue.length > 1 ? "s" : ""} (${total}), the oldest ${oldest} days late`, { amount: total });
  }

  if ((s.pastDueProjects ?? 0) > 0) {
    lose(Math.min(20, s.pastDueProjects * 10), "past_due_projects", `${s.pastDueProjects} active project${s.pastDueProjects > 1 ? "s are" : " is"} past the due date`);
  }

  // No contact: measured from the last logged contact / meeting, or from when the client was added.
  const since = s.lastContactAt ?? s.clientCreatedAt;
  const sinceDay = since ? String(since).slice(0, 10) : null;
  const daysSinceContact = sinceDay ? Math.max(0, daysBetween(sinceDay, s.today)) : null;
  if (daysSinceContact !== null && (s.lastContactAt || daysSinceContact > NEW_CLIENT_GRACE_DAYS)) {
    const points = daysSinceContact > 90 ? 30 : daysSinceContact > 60 ? 20 : daysSinceContact > 30 ? 10 : daysSinceContact > 14 ? 5 : 0;
    if (points > 0) lose(points, "no_contact", s.lastContactAt ? `No contact for ${daysSinceContact} days` : `Never contacted (client added ${daysSinceContact} days ago)`);
  }

  if ((s.lapsedRenewals ?? 0) > 0) {
    lose(Math.min(30, s.lapsedRenewals * 15), "lapsed_renewal", `${s.lapsedRenewals} renewal${s.lapsedRenewals > 1 ? "s" : ""} not paid on time`);
  }

  const idleDays = s.lastPaymentDate ? daysBetween(String(s.lastPaymentDate).slice(0, 10), s.today) : null;
  const idle = idleDays === null ? (s.clientCreatedAt ? daysBetween(String(s.clientCreatedAt).slice(0, 10), s.today) > 90 : false) : idleDays > 90;
  if ((s.activeProjects ?? 0) === 0 && !s.hasRecurring && idle) {
    lose(15, "dormant", "No active work, and nothing paid for over 90 days");
  }

  for (const r of s.renewalsSoon ?? []) {
    reasons.push({ code: "renewal_soon", severity: "good", points: 0, text: `Renewal in ${r.inDays} day${r.inDays === 1 ? "" : "s"} (${r.amount})`, amount: Number(r.amount) });
  }

  score = Math.max(0, Math.min(100, score));
  return { score, level: levelOf(score), reasons, daysSinceContact };
}

/** Clients with their scores, worst first (ties: by name). */
export function rankClients(clients, signalsByClient, today) {
  return clients
    .map((c) => ({ client_id: c.id, name: c.name, ...scoreClient({ today, clientCreatedAt: c.created_at, ...(signalsByClient.get(String(c.id)) ?? {}) }) }))
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
}

const latest = (a, b) => (!a || (b && b > a) ? b : a);

export async function loadClientHealth(companyId, { clientId = null } = {}) {
  const today = todayStr();
  const nowIso = new Date().toISOString();
  const testIds = await testProjectIds(companyId);

  let clientsQuery = supabaseAdmin.from("clients").select("id, name, created_at").eq("company_id", companyId);
  if (clientId) clientsQuery = clientsQuery.eq("id", clientId);

  const [clientsRes, projectsRes, overdueRes, meetings, contacts, renewalsRes, payments] = await Promise.all([
    clientsQuery,
    supabaseAdmin.from("projects").select("id, client_id, status, due_date, is_test").eq("company_id", companyId),
    supabaseAdmin.from("v_ar_aging").select("client_id, remaining_amount, days_overdue").eq("company_id", companyId).gt("remaining_amount", 0).lt("due_date", today).limit(5000),
    selectAll(() => supabaseAdmin.from("meetings").select("id, project_id, scheduled_at").eq("company_id", companyId).neq("status", "cancelled").lte("scheduled_at", nowIso).order("id", { ascending: true })),
    selectAll(() => supabaseAdmin.from("client_contacts").select("id, client_id, contacted_at").eq("company_id", companyId).order("id", { ascending: true })),
    supabaseAdmin.from("recurring_revenue").select("client_id, amount, next_renewal_date, status").eq("company_id", companyId).in("status", ["active", "overdue"]),
    selectAll(() => supabaseAdmin.from("payments").select("id, project_id, payment_date").eq("company_id", companyId).order("id", { ascending: true })),
  ]);
  for (const r of [clientsRes, projectsRes, overdueRes, renewalsRes]) if (r.error) throw r.error;

  const projects = (projectsRes.data || []).filter((p) => !p.is_test && !testIds.some((t) => String(t) === String(p.id)));
  const clientOfProject = new Map(projects.map((p) => [String(p.id), String(p.client_id)]));
  const signals = new Map();
  const sig = (id) => {
    const key = String(id);
    if (!signals.has(key)) signals.set(key, { overdueInvoices: [], pastDueProjects: 0, activeProjects: 0, lapsedRenewals: 0, renewalsSoon: [], hasRecurring: false, lastContactAt: null, lastPaymentDate: null });
    return signals.get(key);
  };

  for (const p of projects) {
    if (p.status === "active") {
      sig(p.client_id).activeProjects += 1;
      if (p.due_date && p.due_date < today) sig(p.client_id).pastDueProjects += 1;
    }
  }
  for (const i of overdueRes.data || []) sig(i.client_id).overdueInvoices.push({ remaining: Number(i.remaining_amount), daysOverdue: Number(i.days_overdue ?? 0) });
  for (const m of meetings) {
    const client = clientOfProject.get(String(m.project_id));
    if (client) sig(client).lastContactAt = latest(sig(client).lastContactAt, m.scheduled_at);
  }
  for (const c of contacts) sig(c.client_id).lastContactAt = latest(sig(c.client_id).lastContactAt, c.contacted_at);
  for (const pay of payments) {
    const client = clientOfProject.get(String(pay.project_id));
    if (client) sig(client).lastPaymentDate = latest(sig(client).lastPaymentDate, pay.payment_date);
  }
  for (const r of renewalsRes.data || []) {
    const s = sig(r.client_id);
    s.hasRecurring = true;
    const inDays = daysBetween(today, r.next_renewal_date);
    if (inDays < 0) s.lapsedRenewals += 1;
    else if (inDays <= 30) s.renewalsSoon.push({ inDays, amount: Number(r.amount) });
  }

  return { today, clients: rankClients(clientsRes.data || [], signals, today) };
}
