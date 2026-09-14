import { supabaseAdmin } from "../../db_connection.js";
import { monthRange } from "../lib/recurring.js";

const table = "recurring_revenue";

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/**
 * GET /api/finance/hosting-summary — feeds the "Upcoming renewals" dashboard widget.
 */
export async function hostingSummary(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { start, end } = monthRange(1); // this month + next month

    const [upcomingRes, overdueRes] = await Promise.all([
      supabaseAdmin
        .from(table)
        .select("id, project_id, client_id, type, amount, next_renewal_date, status")
        .eq("company_id", companyId)
        .in("status", ["active", "overdue"])
        .gte("next_renewal_date", start)
        .lte("next_renewal_date", end)
        .order("next_renewal_date", { ascending: true }),
      supabaseAdmin
        .from(table)
        .select("id, project_id, client_id, type, amount, next_renewal_date")
        .eq("company_id", companyId)
        .eq("status", "overdue")
        .order("next_renewal_date", { ascending: true }),
    ]);
    if (upcomingRes.error) throw upcomingRes.error;
    if (overdueRes.error) throw overdueRes.error;

    const upcomingRows = upcomingRes.data || [];
    const overdueRows = overdueRes.data || [];

    const clientIds = [...new Set(upcomingRows.map((r) => r.client_id).filter(Boolean))];
    let clientNameById = {};
    if (clientIds.length > 0) {
      const { data: clients, error: clientErr } = await supabaseAdmin.from("clients").select("id, name").in("id", clientIds);
      if (clientErr) throw clientErr;
      clientNameById = Object.fromEntries((clients || []).map((c) => [String(c.id), c.name]));
    }

    const upcomingTotal = round2(upcomingRows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0));
    const overdueTotal = round2(overdueRows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0));

    return res.json({
      upcomingTotal,
      upcomingCount: upcomingRows.length,
      overdueTotal,
      overdueCount: overdueRows.length,
      items: upcomingRows.map((r) => ({
        id: r.id,
        type: r.type,
        client_name: clientNameById[String(r.client_id)] ?? null,
        amount: Number(r.amount),
        next_renewal_date: r.next_renewal_date,
        status: r.status,
      })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
