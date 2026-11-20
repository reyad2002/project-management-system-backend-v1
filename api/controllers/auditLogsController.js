import { supabaseAdmin } from "../../db_connection.js";

const table = "audit_logs";
const listFields =
  "id, occurred_at, actor_type, actor_id, actor_name, action, entity_type, entity_id, outcome, status_code, method, path, ip, summary";

/**
 * GET /api/audit-logs
 * Filters: from_date, to_date (YYYY-MM-DD, inclusive), actor_id, actor_type, action, entity_type,
 *          entity_id, outcome (success|failure), q (searches the summary), page, limit (max 100).
 * Always scoped to the caller's company. The list omits before/after; fetch one entry for the diff.
 */
export async function list(req, res) {
  try {
    const companyId = req.user.company_id;
    const { from_date, to_date, actor_id, actor_type, action, entity_type, entity_id, outcome, q, page = "1", limit = "50" } =
      req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);
    const from = (pageNum - 1) * limitNum;

    let query = supabaseAdmin
      .from(table)
      .select(listFields, { count: "exact" })
      .eq("company_id", companyId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + limitNum - 1);

    if (from_date && /^\d{4}-\d{2}-\d{2}$/.test(from_date)) query = query.gte("occurred_at", `${from_date}T00:00:00Z`);
    if (to_date && /^\d{4}-\d{2}-\d{2}$/.test(to_date)) {
      const next = new Date(`${to_date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      query = query.lt("occurred_at", next.toISOString());
    }
    if (actor_id) query = query.eq("actor_id", actor_id);
    if (actor_type) query = query.eq("actor_type", actor_type);
    if (action) query = query.eq("action", action);
    if (entity_type) query = query.eq("entity_type", entity_type);
    if (entity_id) query = query.eq("entity_id", entity_id);
    if (outcome === "success" || outcome === "failure") query = query.eq("outcome", outcome);
    if (q && String(q).trim()) {
      // strip characters that have meaning inside a PostgREST filter
      const term = String(q).trim().replace(/[%,()*]/g, " ");
      query = query.ilike("summary", `%${term}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({ logs: data || [], pagination: { page: pageNum, limit: limitNum, total: count ?? 0 } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** GET /api/audit-logs/:id — the full entry, including the before/after snapshots. */
export async function getOne(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", req.params.id)
      .eq("company_id", req.user.company_id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
