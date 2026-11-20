import { supabaseAdmin } from "../../db_connection.js";
import { getProjectForCompany, validateUserInCompany } from "../lib/tasks.js";
import { createNotification } from "../lib/notifications.js";
import {
  addDefaultTemplates,
  buildTasksFromTemplate,
  ensureDefaultTemplates,
  insertTemplate,
  isDate,
  loadTemplates,
  normalizeTemplateInput,
  todayStr,
} from "../lib/taskTemplates.js";

/** GET /api/task-templates — the company's templates with their tasks (defaults are added on first use). */
export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    await ensureDefaultTemplates(companyId);
    return res.json({ templates: await loadTemplates(companyId) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getOne(req, res) {
  try {
    const companyId = req.user?.company_id;
    const [template] = await loadTemplates(companyId, req.params.id);
    if (!template) return res.status(404).json({ error: "Not found" });
    return res.json(template);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    const parsed = normalizeTemplateInput(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });

    const template = await insertTemplate(companyId, req.user.id, parsed.value);
    const [full] = await loadTemplates(companyId, template.id);
    return res.status(201).json(full);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const companyId = req.user?.company_id;
    const templateId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const [existing] = await loadTemplates(companyId, templateId);
    if (!existing) return res.status(404).json({ error: "Not found" });

    // A save always carries the whole template (name + tasks), like the editor sends it.
    const parsed = normalizeTemplateInput({ ...existing, ...req.body });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const { name, description, project_type, items } = parsed.value;

    const { error } = await supabaseAdmin
      .from("task_templates")
      .update({ name, description, project_type, updated_at: new Date().toISOString() })
      .eq("id", templateId)
      .eq("company_id", companyId);
    if (error) throw error;

    // Insert the new tasks first, then drop the old ones: a failure can't leave the template empty.
    if (req.body?.items !== undefined) {
      const oldIds = existing.items.map((i) => i.id);
      const { error: insertError } = await supabaseAdmin
        .from("task_template_items")
        .insert(items.map((it) => ({ ...it, template_id: templateId })));
      if (insertError) throw insertError;
      if (oldIds.length > 0) {
        const { error: deleteError } = await supabaseAdmin.from("task_template_items").delete().in("id", oldIds);
        if (deleteError) throw deleteError;
      }
    }

    const [full] = await loadTemplates(companyId, templateId);
    return res.json(full);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function remove(req, res) {
  try {
    const companyId = req.user?.company_id;
    const { data, error } = await supabaseAdmin
      .from("task_templates")
      .delete()
      .eq("id", req.params.id)
      .eq("company_id", companyId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/** POST /api/task-templates/defaults — bring back any default template that was deleted or renamed away. */
export async function restoreDefaults(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    const added = await addDefaultTemplates(companyId, req.user.id);
    return res.json({ added });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/task-templates/:id/apply  { project_id, start_date?, assignee_id?, force? }
 * Creates the template's tasks in the project, due dates counted from start_date (default: the project's
 * start date, else today). If this template was already applied to the project it answers 409 until the
 * caller resends with force: true, so the same tasks are never doubled by accident.
 */
export async function apply(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const { project_id: projectId, start_date: startInput, assignee_id: assigneeId, force } = req.body ?? {};
    if (!projectId) return res.status(400).json({ error: "project_id is required" });

    const [template] = await loadTemplates(companyId, req.params.id);
    if (!template) return res.status(404).json({ error: "Template not found" });
    if (template.items.length === 0) return res.status(400).json({ error: "This template has no tasks" });

    const project = await getProjectForCompany(companyId, projectId, "id, company_id, client_id, status, start_date");
    if (!project) return res.status(404).json({ error: "Project not found" });

    const startDate = startInput || project.start_date || todayStr();
    if (!isDate(startDate)) return res.status(400).json({ error: "start_date must be a date (YYYY-MM-DD)" });

    if (assigneeId) {
      if (!(await validateUserInCompany(companyId, assigneeId))) return res.status(400).json({ error: "Invalid assignee_id for this company" });
    }

    const { count: alreadyApplied, error: countError } = await supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("project_id", project.id)
      .eq("template_id", template.id);
    if (countError) throw countError;
    if ((alreadyApplied ?? 0) > 0 && !force) {
      return res.status(409).json({
        error: `"${template.name}" was already applied to this project (${alreadyApplied} tasks). Apply it again anyway?`,
        code: "already_applied",
        existing: alreadyApplied,
      });
    }

    const { count: todoCount, error: todoError } = await supabaseAdmin
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("project_id", project.id)
      .eq("status", "todo");
    if (todoError) throw todoError;
    const basePosition = todoCount ?? 0;

    const rows = buildTasksFromTemplate({
      template,
      items: template.items,
      companyId,
      projectId: project.id,
      userId,
      startDate,
      assigneeId: assigneeId || null,
      basePosition,
    });
    const { data: created, error: insertError } = await supabaseAdmin.from("tasks").insert(rows).select("id, position");
    if (insertError) throw insertError;

    const checklistRows = [];
    for (const task of created || []) {
      const item = template.items[task.position - basePosition];
      (item?.checklist ?? []).forEach((title, position) => checklistRows.push({ task_id: task.id, title: String(title), position, is_done: false }));
    }
    if (checklistRows.length > 0) {
      const { error: checklistError } = await supabaseAdmin.from("task_checklist_items").insert(checklistRows);
      if (checklistError) console.error("[task-templates] checklist failed:", checklistError.message);
    }

    if (assigneeId && String(assigneeId) !== String(userId)) {
      try {
        await createNotification({
          company_id: companyId,
          recipient_type: "team_member",
          recipient_id: assigneeId,
          type: "task_assigned",
          title: `${rows.length} tasks assigned from "${template.name}"`,
          body: null,
        });
      } catch (notifyError) {
        console.error("[task-templates] notification failed:", notifyError.message);
      }
    }

    return res.status(201).json({ created: rows.length, template_id: template.id, project_id: project.id, start_date: startDate });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
