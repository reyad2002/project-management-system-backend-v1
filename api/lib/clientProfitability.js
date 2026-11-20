import { supabaseAdmin } from "../../db_connection.js";
import { NON_PNL_CATEGORIES, daysBetween, round1, round2, selectAll, testProjectIds } from "./db.js";

/**
 * Which clients really make money. Same cash rules as the other reports:
 *  - revenue = payments received in the period; cost = expenses on the client's projects (not advances /
 *    equipment) + supplier bills dated in the period; test projects never count
 *  - outstanding = what the client still owes on unpaid invoices (today, not limited to the period)
 *  - days to pay = average days from the invoice date to the payment, for payments in the period
 */
export const LOW_MARGIN_PERCENT = 15;

export function buildClientProfitability({ clients, projects, payments, expenses, bills, invoices, invoiceDates = {}, from, to }) {
  const liveProjects = projects.filter((p) => !p.is_test);
  const clientOfProject = new Map(liveProjects.map((p) => [String(p.id), String(p.client_id)]));

  const rows = new Map(
    clients.map((c) => [String(c.id), { client_id: c.id, name: c.name, revenue: 0, cost: 0, outstanding: 0, payTimes: [], projectIds: new Set() }]),
  );
  for (const p of liveProjects) rows.get(String(p.client_id))?.projectIds.add(String(p.id));

  for (const pay of payments) {
    const row = rows.get(clientOfProject.get(String(pay.project_id)));
    if (!row) continue;
    row.revenue += Number(pay.amount ?? 0);
    const issued = pay.invoice_id != null ? invoiceDates[String(pay.invoice_id)] : null;
    if (issued && pay.payment_date) row.payTimes.push(Math.max(0, daysBetween(issued, pay.payment_date)));
  }
  for (const e of expenses) {
    if (NON_PNL_CATEGORIES.includes(e.cost_category)) continue;
    const row = rows.get(clientOfProject.get(String(e.project_id)));
    if (row) row.cost += Number(e.amount ?? 0);
  }
  for (const b of bills) {
    if (b.status === "cancelled") continue;
    const row = rows.get(clientOfProject.get(String(b.project_id)));
    if (row) row.cost += Number(b.subtotal ?? 0);
  }
  for (const inv of invoices) {
    if (inv.status === "cancelled" || inv.status === "paid") continue;
    const row = rows.get(String(inv.client_id));
    if (row) row.outstanding += Number(inv.remaining_amount ?? 0);
  }

  const totalRevenue = [...rows.values()].reduce((s, r) => s + r.revenue, 0);
  const list = [...rows.values()]
    .map((r) => {
      const profit = r.revenue - r.cost;
      const margin = r.revenue > 0 ? round1((profit / r.revenue) * 100) : null;
      let flag = null;
      if (r.revenue > 0 || r.cost > 0) {
        if (profit < 0) flag = "loss";
        else if (margin !== null && margin < LOW_MARGIN_PERCENT) flag = "low_margin";
      }
      return {
        client_id: r.client_id,
        name: r.name,
        projects: r.projectIds.size,
        revenue: round2(r.revenue),
        cost: round2(r.cost),
        profit: round2(profit),
        margin,
        share: totalRevenue > 0 ? round1((r.revenue / totalRevenue) * 100) : 0,
        outstanding: round2(r.outstanding),
        avgDaysToPay: r.payTimes.length ? round1(r.payTimes.reduce((s, n) => s + n, 0) / r.payTimes.length) : null,
        flag,
      };
    })
    .filter((r) => r.revenue > 0 || r.cost > 0 || r.outstanding > 0)
    .sort((a, b) => b.profit - a.profit || a.name.localeCompare(b.name));

  const revenue = round2(list.reduce((s, r) => s + r.revenue, 0));
  const cost = round2(list.reduce((s, r) => s + r.cost, 0));
  return {
    period: { from, to },
    clients: list,
    totals: { revenue, cost, profit: round2(revenue - cost), margin: revenue > 0 ? round1(((revenue - cost) / revenue) * 100) : null, outstanding: round2(list.reduce((s, r) => s + r.outstanding, 0)) },
    // The biggest client's share is worth knowing: depending on one client is a risk of its own.
    topClientShare: list.length ? Math.max(...list.map((r) => r.share)) : 0,
  };
}

export async function loadClientProfitability(companyId, from, to) {
  const testIds = await testProjectIds(companyId);
  const notTest = (q, column = "project_id") => (testIds.length ? q.or(`${column}.is.null,${column}.not.in.(${testIds.join(",")})`) : q);

  const [clientsRes, projectsRes, payments, expenses, bills, invoices] = await Promise.all([
    supabaseAdmin.from("clients").select("id, name").eq("company_id", companyId),
    supabaseAdmin.from("projects").select("id, client_id, is_test").eq("company_id", companyId),
    selectAll(() => notTest(supabaseAdmin.from("payments").select("id, amount, payment_date, project_id, invoice_id").eq("company_id", companyId).gte("payment_date", from).lte("payment_date", to)).order("id", { ascending: true })),
    selectAll(() => notTest(supabaseAdmin.from("expenses").select("id, amount, cost_category, project_id").eq("company_id", companyId).not("project_id", "is", null).gte("expense_date", from).lte("expense_date", to)).order("id", { ascending: true })),
    selectAll(() => supabaseAdmin.from("vendor_bills").select("id, subtotal, project_id, status").eq("company_id", companyId).not("project_id", "is", null).gte("bill_date", from).lte("bill_date", to).order("id", { ascending: true })),
    selectAll(() => supabaseAdmin.from("invoices").select("id, client_id, issue_date, remaining_amount, status").eq("company_id", companyId).order("id", { ascending: true })),
  ]);
  if (clientsRes.error) throw clientsRes.error;
  if (projectsRes.error) throw projectsRes.error;

  const invoiceDates = Object.fromEntries(invoices.map((i) => [String(i.id), i.issue_date]));
  return buildClientProfitability({
    clients: clientsRes.data || [],
    projects: projectsRes.data || [],
    payments,
    expenses,
    bills,
    invoices,
    invoiceDates,
    from,
    to,
  });
}
