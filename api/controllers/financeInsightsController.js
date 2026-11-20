import { loadBudgets } from "../lib/budgets.js";
import { loadClientProfitability } from "../lib/clientProfitability.js";
import { loadCashflow } from "../lib/cashflow.js";
import { addDays, parseDate, todayStr } from "../lib/db.js";

const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const MAX_SPAN_DAYS = 3660;

/** GET /api/statistics/project-budgets[?include_done=1] — budgeted projects, the most used up first. */
export async function projectBudgets(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    const projects = await loadBudgets(companyId, { includeDone: req.query.include_done === "1" });
    const totals = projects.reduce((t, p) => ({ budget: t.budget + p.budget, actual: t.actual + p.actual }), { budget: 0, actual: 0 });
    return res.json({
      projects,
      totals: { ...totals, over: projects.filter((p) => p.level === "over").length, warn: projects.filter((p) => p.level === "warn").length },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/statistics/client-profitability?from=&to=  (default: the last 12 months; all=1 for everything)
 */
export async function clientProfitability(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const today = todayStr();
    let from = req.query.from || addDays(today, -364);
    let to = req.query.to || today;
    if (req.query.all === "1") {
      from = "2000-01-01";
      to = today;
    }
    if (!isDate(from) || !isDate(to)) return res.status(400).json({ error: "from and to must be dates (YYYY-MM-DD)" });
    if (from > to) return res.status(400).json({ error: "from must be on or before to" });
    if (req.query.all !== "1" && (parseDate(to) - parseDate(from)) / 86_400_000 > MAX_SPAN_DAYS) return res.status(400).json({ error: "Pick a period of at most 10 years" });

    return res.json(await loadClientProfitability(companyId, from, to));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** GET /api/finance/cashflow?days=90&opening=0 */
export async function cashflow(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const days = req.query.days === undefined ? 90 : Number(req.query.days);
    if (![30, 60, 90].includes(days)) return res.status(400).json({ error: "days must be 30, 60 or 90" });
    const opening = req.query.opening === undefined || req.query.opening === "" ? 0 : Number(req.query.opening);
    if (!Number.isFinite(opening) || Math.abs(opening) > 1e12) return res.status(400).json({ error: "opening must be a number" });

    return res.json(await loadCashflow(companyId, { days, opening }));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
