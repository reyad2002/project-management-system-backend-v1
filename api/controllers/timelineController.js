import { supabaseAdmin } from "../../db_connection.js";
import { getProjectForCompany } from "../lib/tasks.js";

export async function getProjectTimeline(req, res) {
  try {
    const companyId = req.user?.company_id;
    const projectId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const project = await getProjectForCompany(companyId, projectId, "id");
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("v_project_timeline")
      .select("*")
      .eq("company_id", companyId)
      .eq("project_id", projectId);
    if (itemsErr) throw itemsErr;

    const taskIds = (items || []).filter((i) => i.item_type === "task").map((i) => i.id);

    let dependencies = [];
    if (taskIds.length > 0) {
      const { data: deps, error: depsErr } = await supabaseAdmin
        .from("task_dependencies")
        .select("task_id, depends_on_task_id")
        .in("task_id", taskIds);
      if (depsErr) throw depsErr;
      dependencies = deps || [];
    }

    return res.json({
      items: (items || []).map((i) => ({
        id: i.id,
        item_type: i.item_type,
        title: i.title,
        start_date: i.start_date,
        due_date: i.due_date,
        progress_percent: Number(i.progress_percent ?? 0),
        parent_task_id: i.parent_task_id,
        assignee_id: i.assignee_id,
      })),
      dependencies,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
