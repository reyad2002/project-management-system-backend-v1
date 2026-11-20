import { supabaseAdmin } from "../../db_connection.js";

import { chargeDueRecurringExpenses } from "../lib/recurringCharges.js";
import { budgetStatus } from "../lib/budgets.js";

const projectsTable = "projects";
const clientsTable = "clients";
const paymentsTable = "payments";
const expensesTable = "expenses";
const invoicesTable = "invoices";
const vendorBillsTable = "vendor_bills";
const feedbackTable = "feedback";

const projectStatuses = [
  "draft",
  "active",
  "on_hold",
  "cancelled",
  "completed",
];

const accrualRevenueStatuses = ["sent", "partially_paid", "paid", "overdue"];
const directCostCategories = ["materials", "subcontractor", "labor"];

// Not P&L expenses: an employee advance is recovered through salary deduction (the salary itself is
// the cost), and equipment is a capital purchase. They are reported separately, never in profit.
const nonPnlCategories = ["advance", "equipment"];

/**
 * GET /api/statistics
 * Returns dashboard statistics for the authenticated company.
 * Query: from_date, to_date (YYYY-MM-DD) - optional filter for payments and expenses.
 */
export async function getDashboard(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { from_date, to_date } = req.query;

    // Record subscriptions that fell due so the expense totals below are current.
    try {
      await chargeDueRecurringExpenses({ companyId, throttleMs: 60_000 });
    } catch (chargeErr) {
      console.error("[dashboard] auto-charge failed:", chargeErr.message);
    }

    const [
      clientsCount,
      projectsData,
      projectsByStatus,
      paymentsData,
      expensesData,
      recentFeedbackAverage,
    ] = await Promise.all([
      supabaseAdmin
        .from(clientsTable)
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      supabaseAdmin
        .from(projectsTable)
        .select("id, status, price, is_test")
        .eq("company_id", companyId),
      getProjectsByStatus(companyId),
      getPaymentsSummary(companyId, from_date, to_date),
      getExpensesSummary(companyId, from_date, to_date),
      getRecentFeedbackAverage(companyId),
    ]);

    if (clientsCount.error) throw clientsCount.error;
    if (projectsData.error) throw projectsData.error;
    if (projectsByStatus.error) throw projectsByStatus.error;
    if (paymentsData.error) throw paymentsData.error;
    if (expensesData.error) throw expensesData.error;

    // Test/demo projects never count; cancelled projects have no contract value any more.
    const liveProjects = (projectsData.data || []).filter((p) => !p.is_test);
    const totalProjectValue = liveProjects
      .filter((p) => p.status !== "cancelled")
      .reduce((sum, p) => sum + Number(p.price ?? 0), 0);
    const receivables = await getReceivables(companyId, liveProjects);

    const financial = computeFinancialMetrics(
      paymentsData.total,
      expensesData.byType.direct ?? 0,
      expensesData.byType.operational ?? 0,
      expensesData.adSpend ?? 0
    );

    return res.json({
      overview: {
        totalClients: clientsCount.count ?? 0,
        totalProjects: liveProjects.length,
        totalProjectValue: Math.round(totalProjectValue * 100) / 100,
        outstandingReceivables: receivables.outstanding,
        overpaidAmount: receivables.overpaid,
        cancelledProjectsCollected: receivables.cancelledCollected,
        testProjectsExcluded: (projectsData.data?.length ?? 0) - liveProjects.length,
        totalPaymentsReceived: paymentsData.total,
        totalPaymentsCount: paymentsData.count,
        totalExpenses: expensesData.total,
        totalExpensesCount: expensesData.count,
        recentFeedbackAverage,
        dateRange: from_date || to_date ? { from_date: from_date ?? null, to_date: to_date ?? null } : null,
      },
      projectsByStatus: projectsByStatus.data,
      paymentsSummary: {
        total: paymentsData.total,
        count: paymentsData.count,
      },
      expensesSummary: {
        total: expensesData.total,
        count: expensesData.count,
        byType: expensesData.byType,
        adSpend: expensesData.adSpend ?? 0,
        excludedFromProfit: expensesData.excluded ?? { advance: 0, equipment: 0 },
      },
      financial,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/statistics/financial
 * Revenue, direct/operational expenses, gross margin, operating income/margin, net profit, profit margin.
 * Query: from_date, to_date (YYYY-MM-DD), basis ("accrual" default | "cash").
 */
export async function getFinancial(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { from_date, to_date, basis } = req.query;
    const useBasis = basis === "cash" ? "cash" : "accrual";

    let financial;
    if (useBasis === "cash") {
      const [paymentsData, expensesData] = await Promise.all([
        getPaymentsSummary(companyId, from_date, to_date),
        getExpensesSummary(companyId, from_date, to_date),
      ]);
      if (paymentsData.error) throw paymentsData.error;
      if (expensesData.error) throw expensesData.error;

      financial = computeFinancialMetrics(
        paymentsData.total,
        expensesData.byType.direct ?? 0,
        expensesData.byType.operational ?? 0,
        expensesData.adSpend ?? 0
      );
    } else {
      const [revenueResult, expensesResult] = await Promise.all([
        getAccrualRevenue(companyId, from_date, to_date),
        getAccrualExpensesSummary(companyId, from_date, to_date),
      ]);
      if (revenueResult.error) throw revenueResult.error;
      if (expensesResult.error) throw expensesResult.error;

      financial = computeFinancialMetrics(
        revenueResult.total,
        expensesResult.direct,
        expensesResult.operational,
        expensesResult.adSpend ?? 0
      );
    }

    return res.json({
      ...financial,
      basis: useBasis,
      dateRange:
        from_date || to_date
          ? { from_date: from_date ?? null, to_date: to_date ?? null }
          : null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/statistics/overview
 * Lightweight overview counts only (no heavy aggregates).
 */
export async function getOverview(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const [clients, projects, paymentsCount, expensesCount] = await Promise.all([
      supabaseAdmin
        .from(clientsTable)
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      supabaseAdmin
        .from(projectsTable)
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      supabaseAdmin
        .from(paymentsTable)
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      supabaseAdmin
        .from(expensesTable)
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
    ]);

    if (clients.error) throw clients.error;
    if (projects.error) throw projects.error;
    if (paymentsCount.error) throw paymentsCount.error;
    if (expensesCount.error) throw expensesCount.error;

    return res.json({
      totalClients: clients.count ?? 0,
      totalProjects: projects.count ?? 0,
      totalPaymentsCount: paymentsCount.count ?? 0,
      totalExpensesCount: expensesCount.count ?? 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/statistics/projects
 * Project counts by status and total value.
 */
export async function getProjectsStats(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const [byStatus, projectsData] = await Promise.all([
      getProjectsByStatus(companyId),
      supabaseAdmin
        .from(projectsTable)
        .select("id, price")
        .eq("company_id", companyId),
    ]);

    if (byStatus.error) throw byStatus.error;
    if (projectsData.error) throw projectsData.error;

    const totalValue = (projectsData.data || []).reduce(
      (sum, p) => sum + Number(p.price ?? 0),
      0
    );

    return res.json({
      byStatus: byStatus.data,
      totalCount: projectsData.data?.length ?? 0,
      totalValue: Math.round(totalValue * 100) / 100,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/statistics/payments
 * Query: from_date, to_date (YYYY-MM-DD).
 */
export async function getPaymentsStats(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { from_date, to_date } = req.query;
    const result = await getPaymentsSummary(companyId, from_date, to_date);
    if (result.error) throw result.error;

    return res.json({
      total: result.total,
      count: result.count,
      dateRange: from_date || to_date ? { from_date: from_date ?? null, to_date: to_date ?? null } : null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/statistics/expenses
 * Query: from_date, to_date (YYYY-MM-DD).
 */
export async function getExpensesStats(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { from_date, to_date } = req.query;
    const result = await getExpensesSummary(companyId, from_date, to_date);
    if (result.error) throw result.error;

    return res.json({
      total: result.total,
      count: result.count,
      byType: result.byType,
      dateRange: from_date || to_date ? { from_date: from_date ?? null, to_date: to_date ?? null } : null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/statistics/ar-aging
 * Query: client_id, project_id (optional filters). Built from v_ar_aging.
 */
export async function getArAging(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { client_id, project_id } = req.query;

    let query = supabaseAdmin.from("v_ar_aging").select("*").eq("company_id", companyId);
    if (client_id) query = query.eq("client_id", client_id);
    if (project_id) query = query.eq("project_id", project_id);

    const { data, error } = await query;
    if (error) throw error;

    const { buckets, totalOutstanding, rows } = buildAgingBuckets(data || []);

    return res.json({
      buckets,
      totalOutstanding,
      invoices: rows.map((row) => ({
        id: row.id,
        invoice_number: row.invoice_number,
        client_id: row.client_id,
        client_name: row.client_name,
        project_id: row.project_id,
        due_date: row.due_date,
        remaining_amount: row.remaining_amount,
        days_overdue: row.days_overdue,
        bucket: row.bucket,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/statistics/ap-aging
 * Query: vendor_id, project_id (optional filters). Built from v_ap_aging.
 */
export async function getApAging(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { vendor_id, project_id } = req.query;

    let query = supabaseAdmin.from("v_ap_aging").select("*").eq("company_id", companyId);
    if (vendor_id) query = query.eq("vendor_id", vendor_id);
    if (project_id) query = query.eq("project_id", project_id);

    const { data, error } = await query;
    if (error) throw error;

    const { buckets, totalOutstanding, rows } = buildAgingBuckets(data || []);

    return res.json({
      buckets,
      totalOutstanding,
      bills: rows.map((row) => ({
        id: row.id,
        bill_number: row.bill_number,
        vendor_id: row.vendor_id,
        vendor_name: row.vendor_name,
        project_id: row.project_id,
        due_date: row.due_date,
        remaining_amount: row.remaining_amount,
        days_overdue: row.days_overdue,
        bucket: row.bucket,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/statistics/project-profitability
 * With project_id: single project profitability. Without: all projects, sorted by gross profit desc.
 */
export async function getProjectProfitability(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { project_id, page = "1", limit = "20" } = req.query;

    if (project_id) {
      const result = await computeProjectProfitability(companyId, project_id);
      if (!result) return res.status(404).json({ error: "Not found" });
      return res.json(result);
    }

    const { data: projects, error: projErr } = await supabaseAdmin
      .from(projectsTable)
      .select("id, title")
      .eq("company_id", companyId)
      .eq("is_test", false);
    if (projErr) throw projErr;

    const results = await Promise.all(
      (projects || []).map((p) => computeProjectProfitability(companyId, p.id, p.title))
    );
    const sorted = results.filter(Boolean).sort((a, b) => b.grossProfit - a.grossProfit);

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const startIdx = (pageNum - 1) * limitNum;
    const pageItems = sorted.slice(startIdx, startIdx + limitNum);

    return res.json({
      projects: pageItems,
      pagination: { page: pageNum, limit: limitNum, total: sorted.length },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// --- Helpers (return { data } or { error } for use with Promise.all) ---

async function getProjectsByStatus(companyId) {
  const { data, error } = await supabaseAdmin
    .from(projectsTable)
    .select("status")
    .eq("company_id", companyId)
    .eq("is_test", false);

  if (error) return { error };

  const counts = Object.fromEntries(
    projectStatuses.map((s) => [s, 0])
  );
  (data || []).forEach((p) => {
    if (counts[p.status] !== undefined) counts[p.status]++;
  });

  return { data: counts };
}

/**
 * Average of the company's 5 most recent micro-feedback ratings (across all projects).
 */
async function getRecentFeedbackAverage(companyId) {
  const { data, error } = await supabaseAdmin
    .from(feedbackTable)
    .select("rating")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) throw error;
  if (!data || data.length === 0) return null;
  return round2(data.reduce((sum, r) => sum + Number(r.rating ?? 0), 0) / data.length);
}

/** Ids of the company's test/demo projects — their payments and costs are excluded from every report. */
async function getTestProjectIds(companyId) {
  const { data, error } = await supabaseAdmin
    .from(projectsTable)
    .select("id")
    .eq("company_id", companyId)
    .eq("is_test", true);
  if (error) throw error;
  return (data || []).map((p) => p.id);
}

/**
 * Per-project receivables (contract price − payments), ignoring test projects. Cancelled projects
 * carry no receivable (what was collected on them is reported separately); a project that has been
 * paid more than its price contributes to "overpaid", never as a negative receivable.
 */
async function getReceivables(companyId, liveProjects) {
  const { data, error } = await supabaseAdmin
    .from(paymentsTable)
    .select("project_id, amount")
    .eq("company_id", companyId);
  if (error) throw error;

  const paidByProject = new Map();
  (data || []).forEach((row) => {
    const key = String(row.project_id);
    paidByProject.set(key, (paidByProject.get(key) || 0) + Number(row.amount ?? 0));
  });

  let outstanding = 0;
  let overpaid = 0;
  let cancelledCollected = 0;
  liveProjects.forEach((p) => {
    const paid = paidByProject.get(String(p.id)) || 0;
    if (p.status === "cancelled") {
      cancelledCollected += paid;
      return;
    }
    const price = Number(p.price ?? 0);
    if (price > paid) outstanding += price - paid;
    else if (paid > price) overpaid += paid - price;
  });

  return {
    outstanding: round2(outstanding),
    overpaid: round2(overpaid),
    cancelledCollected: round2(cancelledCollected),
  };
}

async function getPaymentsSummary(companyId, fromDate, toDate) {
  const testIds = await getTestProjectIds(companyId);
  let query = supabaseAdmin
    .from(paymentsTable)
    .select("amount")
    .eq("company_id", companyId);
  if (testIds.length > 0) query = query.not("project_id", "in", `(${testIds.join(",")})`);

  if (fromDate) query = query.gte("payment_date", fromDate);
  if (toDate) query = query.lte("payment_date", toDate);

  const { data, error } = await query;
  if (error) return { error, total: 0, count: 0 };

  const total = (data || []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  return {
    total: round2(total),
    count: data?.length ?? 0,
  };
}

async function getExpensesSummary(companyId, fromDate, toDate) {
  const testIds = await getTestProjectIds(companyId);
  let query = supabaseAdmin
    .from(expensesTable)
    .select("amount, type, cost_category")
    .eq("company_id", companyId);

  if (testIds.length > 0) query = query.or(`project_id.is.null,project_id.not.in.(${testIds.join(",")})`);
  if (fromDate) query = query.gte("expense_date", fromDate);
  if (toDate) query = query.lte("expense_date", toDate);

  const { data, error } = await query;
  if (error) return { error, total: 0, count: 0, byType: {}, adSpend: 0, excluded: {} };

  const byType = { direct: 0, operational: 0 };
  const excluded = { advance: 0, equipment: 0 };
  let total = 0;
  let adSpend = 0;
  let count = 0;
  (data || []).forEach((row) => {
    const amt = Number(row.amount ?? 0);
    if (nonPnlCategories.includes(row.cost_category)) {
      excluded[row.cost_category] += amt;
      return;
    }
    count += 1;
    total += amt;
    const t = row.type === "operational" ? "operational" : "direct";
    byType[t] = (byType[t] || 0) + amt;
    if (row.cost_category === "ad_spend") adSpend += amt;
  });

  return {
    total: round2(total),
    count,
    byType: {
      direct: round2(byType.direct || 0),
      operational: round2(byType.operational || 0),
    },
    adSpend: round2(adSpend),
    excluded: { advance: round2(excluded.advance), equipment: round2(excluded.equipment) },
  };
}

/**
 * Accrual revenue: SUM(invoices.subtotal) for issued/outstanding invoices in range.
 */
async function getAccrualRevenue(companyId, fromDate, toDate) {
  let query = supabaseAdmin
    .from(invoicesTable)
    .select("subtotal")
    .eq("company_id", companyId)
    .in("status", accrualRevenueStatuses);

  if (fromDate) query = query.gte("issue_date", fromDate);
  if (toDate) query = query.lte("issue_date", toDate);

  const { data, error } = await query;
  if (error) return { error, total: 0 };

  const total = (data || []).reduce((sum, row) => sum + Number(row.subtotal ?? 0), 0);
  return { total: round2(total) };
}

/**
 * Accrual direct/operational expenses: expenses table (by type) + vendor_bills (by cost_category bucket).
 */
async function getAccrualExpensesSummary(companyId, fromDate, toDate) {
  const testIds = await getTestProjectIds(companyId);
  let expQuery = supabaseAdmin
    .from(expensesTable)
    .select("amount, type, cost_category")
    .eq("company_id", companyId);
  if (testIds.length > 0) expQuery = expQuery.or(`project_id.is.null,project_id.not.in.(${testIds.join(",")})`);
  if (fromDate) expQuery = expQuery.gte("expense_date", fromDate);
  if (toDate) expQuery = expQuery.lte("expense_date", toDate);

  let billQuery = supabaseAdmin
    .from(vendorBillsTable)
    .select("subtotal, cost_category")
    .eq("company_id", companyId)
    .neq("status", "cancelled");
  if (fromDate) billQuery = billQuery.gte("bill_date", fromDate);
  if (toDate) billQuery = billQuery.lte("bill_date", toDate);

  const [expResult, billResult] = await Promise.all([expQuery, billQuery]);
  if (expResult.error) return { error: expResult.error, direct: 0, operational: 0, adSpend: 0 };
  if (billResult.error) return { error: billResult.error, direct: 0, operational: 0, adSpend: 0 };

  let direct = 0;
  let operational = 0;
  let adSpend = 0;

  (expResult.data || []).forEach((row) => {
    if (nonPnlCategories.includes(row.cost_category)) return;
    const amt = Number(row.amount ?? 0);
    if (row.type === "direct") direct += amt;
    else operational += amt;
    if (row.cost_category === "ad_spend") adSpend += amt;
  });

  (billResult.data || []).forEach((row) => {
    const amt = Number(row.subtotal ?? 0);
    if (directCostCategories.includes(row.cost_category)) direct += amt;
    else operational += amt;
  });

  return { direct: round2(direct), operational: round2(operational), adSpend: round2(adSpend) };
}

/**
 * Bucket a v_ar_aging / v_ap_aging result set into the 5 standard aging buckets.
 */
function buildAgingBuckets(rows) {
  const bucketKeys = ["current", "1_30", "31_60", "61_90", "over_90"];
  const buckets = Object.fromEntries(bucketKeys.map((k) => [k, { count: 0, amount: 0 }]));
  let totalOutstanding = 0;

  rows.forEach((row) => {
    const amt = Number(row.remaining_amount ?? 0);
    totalOutstanding += amt;
    if (buckets[row.bucket]) {
      buckets[row.bucket].count += 1;
      buckets[row.bucket].amount = round2(buckets[row.bucket].amount + amt);
    }
  });

  return { buckets, totalOutstanding: round2(totalOutstanding), rows };
}

/**
 * Job-costing profitability for a single project.
 *
 * Revenue: invoiced subtotal when the project has invoices; otherwise the cash actually collected
 * (many projects are paid without invoices) — `revenueBasis` says which one was used. Employee
 * advances and equipment purchases are not project costs. For marketing packages the client's ad
 * budget is tracked against the ad spend actually paid out.
 */
async function computeProjectProfitability(companyId, projectId, titleHint) {
  const { data: project, error: projectErr } = await supabaseAdmin
    .from(projectsTable)
    .select("id, title, ad_budget, budget_cost")
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (projectErr) throw projectErr;
  if (!project) return null;
  const title = titleHint ?? project.title;

  const [invoicesRes, paymentsRes, expensesRes, billsRes] = await Promise.all([
    supabaseAdmin
      .from(invoicesTable)
      .select("subtotal")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .neq("status", "cancelled"),
    supabaseAdmin
      .from(paymentsTable)
      .select("amount")
      .eq("company_id", companyId)
      .eq("project_id", projectId),
    supabaseAdmin
      .from(expensesTable)
      .select("amount, cost_category")
      .eq("company_id", companyId)
      .eq("project_id", projectId),
    supabaseAdmin
      .from(vendorBillsTable)
      .select("subtotal, cost_category")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .neq("status", "cancelled"),
  ]);
  if (invoicesRes.error) throw invoicesRes.error;
  if (paymentsRes.error) throw paymentsRes.error;
  if (expensesRes.error) throw expensesRes.error;
  if (billsRes.error) throw billsRes.error;

  const invoicedRevenue = round2(
    (invoicesRes.data || []).reduce((sum, r) => sum + Number(r.subtotal ?? 0), 0)
  );
  const collectedRevenue = round2(
    (paymentsRes.data || []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0)
  );
  const revenueBasis = invoicedRevenue > 0 ? "invoices" : "payments";
  const revenue = revenueBasis === "invoices" ? invoicedRevenue : collectedRevenue;

  const costBreakdown = {};
  let totalCost = 0;
  (expensesRes.data || []).forEach((row) => {
    if (nonPnlCategories.includes(row.cost_category)) return;
    const amt = Number(row.amount ?? 0);
    const cat = row.cost_category || "other";
    costBreakdown[cat] = round2((costBreakdown[cat] || 0) + amt);
    totalCost += amt;
  });
  (billsRes.data || []).forEach((row) => {
    const amt = Number(row.subtotal ?? 0);
    const cat = row.cost_category || "other";
    costBreakdown[cat] = round2((costBreakdown[cat] || 0) + amt);
    totalCost += amt;
  });
  totalCost = round2(totalCost);

  const grossProfit = round2(revenue - totalCost);
  const grossMargin = revenue > 0 ? round2((grossProfit / revenue) * 100) : 0;

  const adBudget = round2(Number(project.ad_budget ?? 0));
  const adSpend = round2(costBreakdown.ad_spend ?? 0);

  return {
    project_id: projectId,
    title,
    recognizedRevenue: revenue,
    revenueBasis,
    collectedRevenue,
    totalCost,
    costBreakdown,
    grossProfit,
    grossMargin,
    adBudget,
    adSpend,
    // Negative = more was spent on ads than the client's budget; positive = client money not yet spent.
    adBudgetRemaining: adBudget > 0 ? round2(adBudget - adSpend) : null,
    // The expected cost set on the project, and how much of it is used (positive variance = under budget).
    budgetedCost: project.budget_cost != null ? round2(Number(project.budget_cost)) : null,
    budgetVariance: project.budget_cost != null ? round2(Number(project.budget_cost) - totalCost) : null,
    budgetPercent: project.budget_cost != null ? budgetStatus(project.budget_cost, totalCost).percent : null,
    budgetLevel: project.budget_cost != null ? budgetStatus(project.budget_cost, totalCost).level : null,
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Compute profitability metrics from revenue and expense totals.
 */
function computeFinancialMetrics(revenue, directExpenses, operationalExpenses, adSpend = 0) {
  const totalExpenses = round2(directExpenses + operationalExpenses);
  const grossProfit = round2(revenue - directExpenses);
  const operatingIncome = round2(revenue - directExpenses - operationalExpenses);
  const netProfit = operatingIncome; // same in this model (no other income/expenses)

  const grossMarginPercent =
    revenue > 0 ? round2((grossProfit / revenue) * 100) : 0;
  const operatingMarginPercent =
    revenue > 0 ? round2((operatingIncome / revenue) * 100) : 0;
  const profitMarginPercent =
    revenue > 0 ? round2((netProfit / revenue) * 100) : 0;

  return {
    totalRevenue: round2(revenue),
    directExpenses: round2(directExpenses),
    operationalExpenses: round2(operationalExpenses),
    totalExpenses,
    // Ad spend is already inside directExpenses; shown separately because marketing packages
    // bundle the client's ad budget into what they pay (revenue after ad spend = our real fee).
    adSpend: round2(adSpend),
    netRevenueAfterAdSpend: round2(revenue - adSpend),
    grossProfit,
    grossMargin: { amount: grossProfit, percent: grossMarginPercent },
    operatingIncome,
    operatingMargin: { amount: operatingIncome, percent: operatingMarginPercent },
    netProfit,
    profitMargin: { amount: netProfit, percent: profitMarginPercent },
  };
}
