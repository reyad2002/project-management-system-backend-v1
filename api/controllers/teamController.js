import { supabaseAdmin } from "../../db_connection.js";

export async function getWorkload(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data, error } = await supabaseAdmin
      .from("v_user_workload")
      .select("*")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) throw error;

    const members = (data || []).map((row) => ({
      user_id: row.user_id,
      name: row.name,
      active_projects_count: row.active_projects_count ?? 0,
      total_allocation_percent: Number(row.total_allocation_percent ?? 0),
      open_tasks_count: row.open_tasks_count ?? 0,
      overdue_tasks_count: row.overdue_tasks_count ?? 0,
    }));

    return res.json({ members });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
