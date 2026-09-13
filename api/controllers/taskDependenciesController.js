import { supabaseAdmin } from "../../db_connection.js";
import { getTaskForCompany, enrichTasks, wouldCreateCircularDependency } from "../lib/tasks.js";

const table = "task_dependencies";
const dependencyTypes = ["finish_to_start", "start_to_start"];

export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    const taskId = req.params.taskId;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const task = await getTaskForCompany(companyId, taskId, "id");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const { data: deps, error: depsErr } = await supabaseAdmin
      .from(table)
      .select("depends_on_task_id")
      .eq("task_id", taskId);
    if (depsErr) throw depsErr;

    const dependsOnIds = (deps || []).map((d) => d.depends_on_task_id);
    if (dependsOnIds.length === 0) return res.json({ dependsOn: [] });

    const { data: tasks, error: tasksErr } = await supabaseAdmin
      .from("tasks")
      .select("*")
      .eq("company_id", companyId)
      .in("id", dependsOnIds);
    if (tasksErr) throw tasksErr;

    const dependsOn = await enrichTasks(companyId, tasks || []);
    return res.json({ dependsOn });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    const taskId = req.params.taskId;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const task = await getTaskForCompany(companyId, taskId, "id, project_id");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const { depends_on_task_id, dependency_type } = req.body;
    if (!depends_on_task_id) {
      return res.status(400).json({ error: "depends_on_task_id is required" });
    }
    if (String(depends_on_task_id) === String(taskId)) {
      return res.status(400).json({ error: "A task cannot depend on itself" });
    }
    if (dependency_type != null && !dependencyTypes.includes(dependency_type)) {
      return res.status(400).json({ error: "Invalid dependency_type" });
    }

    const dependsOnTask = await getTaskForCompany(companyId, depends_on_task_id, "id, project_id");
    if (!dependsOnTask || String(dependsOnTask.project_id) !== String(task.project_id)) {
      return res.status(400).json({ error: "depends_on_task_id must belong to the same project" });
    }

    const isCircular = await wouldCreateCircularDependency(depends_on_task_id, taskId);
    if (isCircular) {
      return res.status(400).json({ error: "Circular dependency detected" });
    }

    const payload = {
      task_id: taskId,
      depends_on_task_id,
      dependency_type: dependency_type ?? "finish_to_start",
    };

    const { data, error } = await supabaseAdmin.from(table).insert(payload).select("*").single();
    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "This dependency already exists" });
      }
      throw error;
    }

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function remove(req, res) {
  try {
    const companyId = req.user?.company_id;
    const taskId = req.params.taskId;
    const dependsOnId = req.params.dependsOnId;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const task = await getTaskForCompany(companyId, taskId, "id");
    if (!task) return res.status(404).json({ error: "Task not found" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("task_id", taskId)
      .eq("depends_on_task_id", dependsOnId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
