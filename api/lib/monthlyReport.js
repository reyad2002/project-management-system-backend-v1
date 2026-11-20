import { supabaseAdmin } from "../../db_connection.js";

/**
 * Monthly financial report (cash basis: money actually received and spent, by the date it happened).
 *
 * Same rules as the dashboard so the numbers always agree with it:
 *  - payments and costs of test projects are left out;
 *  - employee advances and equipment purchases are recorded but kept out of profit
 *    (an advance is recovered through salary, equipment is capital) and reported separately;
 *  - ad spend is part of direct costs and also shown on its own.
 *
 * The aggregation functions are pure (rows in, report out) so they can be tested without a database.
 */

export const NON_PNL_CATEGORIES = ["advance", "equipment"];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const monthKey = (year, monthIndex) => `${year}-${String(monthIndex + 1).padStart(2, "0")}`;

function emptyMonth(key) {
  return {
    month: key,
    revenue: 0,
    paymentsCount: 0,
    directExpenses: 0,
    operationalExpenses: 0,
    adSpend: 0,
    excludedFromProfit: { advance: 0, equipment: 0 },
  };
}

function addPayment(m, payment) {
  m.revenue += Number(payment.amount ?? 0);
  m.paymentsCount += 1;
}

/** Adds an expense to a month bucket; returns false when it belongs outside profit. */
function addExpense(m, expense) {
  const amount = Number(expense.amount ?? 0);
  if (NON_PNL_CATEGORIES.includes(expense.cost_category)) {
    m.excludedFromProfit[expense.cost_category] += amount;
    return false;
  }
  if (expense.type === "operational") m.operationalExpenses += amount;
  else m.directExpenses += amount;
  if (expense.cost_category === "ad_spend") m.adSpend += amount;
  return true;
}

function finalize(m) {
  const totalExpenses = m.directExpenses + m.operationalExpenses;
  const grossProfit = m.revenue - m.directExpenses;
  const netProfit = m.revenue - totalExpenses;
  return {
    month: m.month,
    revenue: round2(m.revenue),
    paymentsCount: m.paymentsCount,
    directExpenses: round2(m.directExpenses),
    operationalExpenses: round2(m.operationalExpenses),
    totalExpenses: round2(totalExpenses),
    adSpend: round2(m.adSpend),
    grossProfit: round2(grossProfit),
    netProfit: round2(netProfit),
    // No revenue -> a percentage would be meaningless, not "0%".
    marginPercent: m.revenue > 0 ? round2((netProfit / m.revenue) * 100) : null,
    excludedFromProfit: {
      advance: round2(m.excludedFromProfit.advance),
      equipment: round2(m.excludedFromProfit.equipment),
    },
  };
}

export function aggregateYear(year, payments, expenses) {
  const buckets = Array.from({ length: 12 }, (_, i) => emptyMonth(monthKey(year, i)));
  const inYear = (date) => typeof date === "string" && date.startsWith(`${year}-`);
  const bucketOf = (date) => buckets[Number(date.slice(5, 7)) - 1];

  for (const p of payments) if (inYear(p.payment_date) && bucketOf(p.payment_date)) addPayment(bucketOf(p.payment_date), p);
  for (const e of expenses) if (inYear(e.expense_date) && bucketOf(e.expense_date)) addExpense(bucketOf(e.expense_date), e);

  const total = emptyMonth(String(year));
  for (const b of buckets) {
    total.revenue += b.revenue;
    total.paymentsCount += b.paymentsCount;
    total.directExpenses += b.directExpenses;
    total.operationalExpenses += b.operationalExpenses;
    total.adSpend += b.adSpend;
    total.excludedFromProfit.advance += b.excludedFromProfit.advance;
    total.excludedFromProfit.equipment += b.excludedFromProfit.equipment;
  }

  return { year, basis: "cash", months: buckets.map(finalize), totals: finalize(total) };
}

/** One month in detail: where the money came from and where it went. */
export function aggregateMonth(month, payments, expenses, projectTitleById = {}) {
  const bucket = emptyMonth(month);
  const revenueByProject = new Map();
  const costByCategory = new Map();
  const pnlExpenses = [];

  for (const p of payments) {
    if (!String(p.payment_date).startsWith(`${month}-`)) continue;
    addPayment(bucket, p);
    const key = String(p.project_id);
    const row = revenueByProject.get(key) ?? { project_id: p.project_id, title: projectTitleById[key] ?? null, amount: 0, count: 0 };
    row.amount += Number(p.amount ?? 0);
    row.count += 1;
    revenueByProject.set(key, row);
  }

  for (const e of expenses) {
    if (!String(e.expense_date).startsWith(`${month}-`)) continue;
    if (!addExpense(bucket, e)) continue;
    const category = e.cost_category ?? "other";
    const row = costByCategory.get(category) ?? { category, amount: 0, count: 0 };
    row.amount += Number(e.amount ?? 0);
    row.count += 1;
    costByCategory.set(category, row);
    pnlExpenses.push(e);
  }

  const byAmountDesc = (a, b) => b.amount - a.amount;
  return {
    month,
    summary: finalize(bucket),
    revenueByProject: [...revenueByProject.values()].map((r) => ({ ...r, amount: round2(r.amount) })).sort(byAmountDesc),
    expensesByCategory: [...costByCategory.values()].map((r) => ({ ...r, amount: round2(r.amount) })).sort(byAmountDesc),
    topExpenses: [...pnlExpenses]
      .sort((a, b) => Number(b.amount) - Number(a.amount))
      .slice(0, 10)
      .map((e) => ({
        id: e.id,
        title: e.title,
        expense_date: e.expense_date,
        amount: round2(e.amount),
        type: e.type,
        cost_category: e.cost_category,
        project_title: e.project_id != null ? projectTitleById[String(e.project_id)] ?? null : null,
      })),
  };
}

// ---------------------------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------------------------

/** PostgREST returns at most 1000 rows per request; page through so a busy year isn't silently cut off. */
async function selectAll(buildQuery) {
  const pageSize = 1000;
  const maxPages = 50; // 50,000 rows — far beyond a year of one company's payments/expenses
  const rows = [];
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function testProjectIds(companyId) {
  const { data, error } = await supabaseAdmin.from("projects").select("id").eq("company_id", companyId).eq("is_test", true);
  if (error) throw error;
  return (data || []).map((p) => p.id);
}

export async function loadRange(companyId, fromDate, toDate) {
  const testIds = await testProjectIds(companyId);

  const payments = await selectAll(() => {
    let q = supabaseAdmin
      .from("payments")
      .select("id, payment_date, amount, project_id, payment_method, notes")
      .eq("company_id", companyId)
      .gte("payment_date", fromDate)
      .lte("payment_date", toDate)
      .order("id", { ascending: true });
    if (testIds.length > 0) q = q.not("project_id", "in", `(${testIds.join(",")})`);
    return q;
  });

  const expenses = await selectAll(() => {
    let q = supabaseAdmin
      .from("expenses")
      .select("id, title, description, amount, type, cost_category, expense_date, project_id")
      .eq("company_id", companyId)
      .gte("expense_date", fromDate)
      .lte("expense_date", toDate)
      .order("id", { ascending: true });
    if (testIds.length > 0) q = q.or(`project_id.is.null,project_id.not.in.(${testIds.join(",")})`);
    return q;
  });

  return { payments, expenses };
}

export async function projectTitles(companyId, projectIds) {
  const ids = [...new Set(projectIds.filter((id) => id != null))];
  if (ids.length === 0) return {};
  const { data, error } = await supabaseAdmin.from("projects").select("id, title").eq("company_id", companyId).in("id", ids);
  if (error) throw error;
  return Object.fromEntries((data || []).map((p) => [String(p.id), p.title]));
}

/**
 * @param {{ withRows?: boolean }} [options] withRows also returns the individual payments and costs the
 *   report is made of (same filters: test projects out), for the Excel export's detail sheets.
 */
export async function buildYearReport(companyId, year, { withRows = false } = {}) {
  const { payments, expenses } = await loadRange(companyId, `${year}-01-01`, `${year}-12-31`);
  const report = aggregateYear(year, payments, expenses);
  if (!withRows) return report;

  const titles = await projectTitles(companyId, [...payments.map((p) => p.project_id), ...expenses.map((e) => e.project_id)]);
  const titleOf = (id) => (id != null ? titles[String(id)] ?? null : null);
  return {
    ...report,
    rows: {
      payments: payments
        .map((p) => ({ date: p.payment_date, project_title: titleOf(p.project_id), amount: round2(p.amount), method: p.payment_method, notes: p.notes }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      expenses: expenses
        .map((e) => ({
          date: e.expense_date,
          title: e.title,
          type: e.type,
          cost_category: e.cost_category,
          project_title: titleOf(e.project_id),
          amount: round2(e.amount),
          description: e.description,
          in_profit: !NON_PNL_CATEGORIES.includes(e.cost_category),
        }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    },
  };
}

export async function buildMonthReport(companyId, month) {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const { payments, expenses } = await loadRange(companyId, `${month}-01`, `${month}-${String(lastDay).padStart(2, "0")}`);
  const titles = await projectTitles(companyId, [...payments.map((p) => p.project_id), ...expenses.map((e) => e.project_id)]);
  return aggregateMonth(month, payments, expenses, titles);
}
