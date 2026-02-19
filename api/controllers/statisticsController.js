import { supabaseAdmin } from "../../db_connection.js";

const projectsTable = "projects";
const clientsTable = "clients";
const paymentsTable = "payments";
const expensesTable = "expenses";

const projectStatuses = [
  "draft",
  "active",
  "on_hold",
  "cancelled",
  "completed",
];

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
 * Query: from_date, to_date (YYYY-MM-DD) - optional filter for payments and expenses.
 */
export async function getFinancial(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { from_date, to_date } = req.query;

    const [paymentsData, expensesData] = await Promise.all([
      getPaymentsSummary(companyId, from_date, to_date),
      getExpensesSummary(companyId, from_date, to_date),
    ]);

    if (paymentsData.error) throw paymentsData.error;
    if (expensesData.error) throw expensesData.error;

    const financial = computeFinancialMetrics(
      paymentsData.total,
      expensesData.byType.direct ?? 0,
      expensesData.byType.operational ?? 0
    );

    return res.json({
      ...financial,
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

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * Compute profitability metrics from revenue and expense totals.
 * Revenue = total payments; direct/operational from expenses by type.
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
