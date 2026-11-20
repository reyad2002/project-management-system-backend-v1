import { buildMonthReport, buildYearReport } from "../lib/monthlyReport.js";

/** GET /api/statistics/monthly?year=2026[&rows=1] — the 12 months of a year plus its totals (rows=1 adds the individual payments and costs). */
export async function getYear(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const year = req.query.year === undefined ? new Date().getUTCFullYear() : Number(req.query.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return res.status(400).json({ error: "year must be a number between 2000 and 2100" });
    }

    return res.json(await buildYearReport(companyId, year, { withRows: req.query.rows === "1" }));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** GET /api/statistics/monthly/2026-09 — one month in detail (by project, by category, biggest costs). */
export async function getMonth(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { month } = req.params;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ error: "month must look like 2026-09" });
    }

    return res.json(await buildMonthReport(companyId, month));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
