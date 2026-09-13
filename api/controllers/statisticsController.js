import { supabaseAdmin } from "../../db_connection.js";

const projectsTable = "projects";
const clientsTable = "clients";
const paymentsTable = "payments";
const expensesTable = "expenses";
const invoicesTable = "invoices";
const vendorBillsTable = "vendor_bills";

const projectStatuses = [
  "draft",
  "active",
  "on_hold",
  "cancelled",
  "completed",
];

const accrualRevenueStatuses = ["sent", "partially_paid", "paid", "overdue"];
const directCostCategories = ["materials", "subcontractor", "labor"];

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

    const [
      clientsCount,
      projectsData,
      projectsByStatus,
      paymentsData,
      expensesData,
    ] = await Promise.all([
      supabaseAdmin
        .from(clientsTable)
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId),
      supabaseAdmin
        .from(projectsTable)
        .select("id, status, price")
        .eq("company_id", companyId),
      getProjectsByStatus(companyId),
      getPaymentsSummary(companyId, from_date, to_date),
      getExpensesSummary(companyId, from_date, to_date),
    ]);

    if (clientsCount.error) throw clientsCount.error;
    if (projectsData.error) throw projectsData.error;
    if (projectsByStatus.error) throw projectsByStatus.error;
    if (paymentsData.error) throw paymentsData.error;
    if (expensesData.error) throw expensesData.error;

    const totalProjectValue = (projectsData.data || []).reduce(
      (sum, p) => sum + Number(p.price ?? 0),
      0
    );

    const financial = computeFinancialMetrics(
      paymentsData.total,
      expensesData.byType.direct ?? 0,
      expensesData.byType.operational ?? 0
    );

    return res.json({
      overview: {
        totalClients: clientsCount.count ?? 0,
        totalProjects: projectsData.data?.length ?? 0,
        totalProjectValue: Math.round(totalProjectValue * 100) / 100,
        totalPaymentsReceived: paymentsData.total,
        totalPaymentsCount: paymentsData.count,
        totalExpenses: expensesData.total,
        totalExpensesCount: expensesData.count,
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
        expensesData.byType.operational ?? 0
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
        expensesResult.operational
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
      .eq("company_id", companyId);
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
    .eq("company_id", companyId);

  if (error) return { error };

  const counts = Object.fromEntries(
    projectStatuses.map((s) => [s, 0])
  );
  (data || []).forEach((p) => {
    if (counts[p.status] !== undefined) counts[p.status]++;
  });

  return { data: counts };
}

async function getPaymentsSummary(companyId, fromDate, toDate) {
  let query = supabaseAdmin
    .from(paymentsTable)
    .select("amount")
    .eq("company_id", companyId);

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
  let query = supabaseAdmin
    .from(expensesTable)
    .select("amount, type")
    .eq("company_id", companyId);

  if (fromDate) query = query.gte("expense_date", fromDate);
  if (toDate) query = query.lte("expense_date", toDate);

  const { data, error } = await query;
  if (error) return { error, total: 0, count: 0, byType: {} };

  const byType = { direct: 0, operational: 0 };
  let total = 0;
  (data || []).forEach((row) => {
    const amt = Number(row.amount ?? 0);
    total += amt;
    const t = row.type === "operational" ? "operational" : "direct";
    byType[t] = (byType[t] || 0) + amt;
  });

  return {
    total: round2(total),
    count: data?.length ?? 0,
    byType: {
      direct: round2(byType.direct || 0),
      operational: round2(byType.operational || 0),
    },
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
  let expQuery = supabaseAdmin
    .from(expensesTable)
    .select("amount, type")
    .eq("company_id", companyId);
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
  if (expResult.error) return { error: expResult.error, direct: 0, operational: 0 };
  if (billResult.error) return { error: billResult.error, direct: 0, operational: 0 };

  let direct = 0;
  let operational = 0;

  (expResult.data || []).forEach((row) => {
    const amt = Number(row.amount ?? 0);
    if (row.type === "direct") direct += amt;
    else operational += amt;
  });

  (billResult.data || []).forEach((row) => {
    const amt = Number(row.subtotal ?? 0);
    if (directCostCategories.includes(row.cost_category)) direct += amt;
    else operational += amt;
  });

  return { direct: round2(direct), operational: round2(operational) };
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
 */
async function computeProjectProfitability(companyId, projectId, titleHint) {
  let title = titleHint;
  if (title === undefined) {
    const { data: project, error } = await supabaseAdmin
      .from(projectsTable)
      .select("id, title")
      .eq("id", projectId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw error;
    if (!project) return null;
    title = project.title;
  }

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

  const recognizedRevenue = round2(
    (invoicesRes.data || []).reduce((sum, r) => sum + Number(r.subtotal ?? 0), 0)
  );
  const collectedRevenue = round2(
    (paymentsRes.data || []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0)
  );

  const costBreakdown = {};
  let totalCost = 0;
  (expensesRes.data || []).forEach((row) => {
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

  const grossProfit = round2(recognizedRevenue - totalCost);
  const grossMargin = recognizedRevenue > 0 ? round2((grossProfit / recognizedRevenue) * 100) : 0;

  return {
    project_id: projectId,
    title,
    recognizedRevenue,
    collectedRevenue,
    totalCost,
    costBreakdown,
    grossProfit,
    grossMargin,
    budgetedCost: null,
    budgetVariance: null,
  };
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Compute profitability metrics from revenue and expense totals.
 */
function computeFinancialMetrics(revenue, directExpenses, operationalExpenses) {
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
    grossProfit,
    grossMargin: { amount: grossProfit, percent: grossMarginPercent },
    operatingIncome,
    operatingMargin: { amount: operatingIncome, percent: operatingMarginPercent },
    netProfit,
    profitMargin: { amount: netProfit, percent: profitMarginPercent },
  };
}
