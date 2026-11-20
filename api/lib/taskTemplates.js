import { supabaseAdmin } from "../../db_connection.js";
import { taskPriorities } from "./tasks.js";
import { addDays, todayStr } from "./taskRecurrence.js";

export const PROJECT_TYPES = ["software", "marketing", "branding", "social_media", "other"];

const MAX_ITEMS = 50;
const MAX_CHECKLIST = 30;

/**
 * Ready-made templates, added once per company the first time templates are opened. They are an
 * ordinary editable copy afterwards: rename, change, delete, add your own. `offset` = days after the
 * project's start date.
 */
export const DEFAULT_TEMPLATES = [
  {
    name: "Software project",
    project_type: "software",
    description: "Requirements to hand-over for a website or app.",
    items: [
      { title: "Kick-off and requirements", offset: 0, priority: "high", checklist: ["Confirm scope with the client", "Collect access and assets", "Agree the timeline"] },
      { title: "UX / UI design", offset: 7, checklist: ["Wireframes", "Visual design", "Client sign-off on design"] },
      { title: "Development - first milestone", offset: 21 },
      { title: "Client review", offset: 25, priority: "high" },
      { title: "Development - second milestone", offset: 35 },
      { title: "Testing and QA", offset: 42, checklist: ["Functional testing", "Mobile and browser checks", "Fix reported issues"] },
      { title: "Deployment", offset: 46, priority: "high" },
      { title: "Hand-over and documentation", offset: 50 },
    ],
  },
  {
    name: "Marketing campaign",
    project_type: "marketing",
    description: "Brief, plan, creatives, launch and report.",
    items: [
      { title: "Brief and goals", offset: 0, priority: "high", checklist: ["Goals and KPIs", "Budget and ad account access"] },
      { title: "Audience and competitor research", offset: 3 },
      { title: "Campaign plan and budget split", offset: 6, priority: "high" },
      { title: "Creatives (copy, design, video)", offset: 12 },
      { title: "Client approval", offset: 14, priority: "high" },
      { title: "Launch campaign", offset: 16, priority: "high" },
      { title: "Mid-campaign optimisation", offset: 23 },
      { title: "Monthly performance report", offset: 30, checklist: ["Spend vs budget", "Results vs KPIs", "Recommendations"] },
    ],
  },
  {
    name: "Branding project",
    project_type: "branding",
    description: "Discovery to final brand files.",
    items: [
      { title: "Discovery workshop", offset: 0, priority: "high" },
      { title: "Mood board and direction", offset: 5 },
      { title: "Logo concepts", offset: 12 },
      { title: "Client feedback round", offset: 15, priority: "high" },
      { title: "Brand guidelines", offset: 22 },
      { title: "Final files and hand-over", offset: 28, checklist: ["Logo pack (all formats)", "Brand guidelines PDF", "Fonts and colours"] },
    ],
  },
  {
    name: "Social media management (monthly)",
    project_type: "social_media",
    description: "The monthly content cycle.",
    items: [
      { title: "Gather brand assets and account access", offset: 0, priority: "high" },
      { title: "Monthly content plan", offset: 3, priority: "high" },
      { title: "Design the posts", offset: 8 },
      { title: "Client approval of the plan", offset: 10, priority: "high" },
      { title: "Schedule and publish", offset: 12 },
      { title: "Community management and replies", offset: 20 },
      { title: "Monthly report", offset: 30, checklist: ["Reach and engagement", "Best posts", "Next month ideas"] },
    ],
  },
  {
    name: "General project",
    project_type: "other",
    description: "A simple start, delivery and review.",
    items: [
      { title: "Kick-off", offset: 0, priority: "high" },
      { title: "Delivery", offset: 14 },
      { title: "Review with the client", offset: 18, priority: "high" },
      { title: "Close and hand-over", offset: 21 },
    ],
  },
];

/** Validate a template body; returns { error } or { value: { name, description, project_type, items } }. */
export function normalizeTemplateInput(body, { requireItems = true } = {}) {
  const name = String(body?.name ?? "").trim();
  if (!name) return { error: "name is required" };
  if (name.length > 120) return { error: "name is too long (max 120)" };

  const description = body?.description ? String(body.description).trim().slice(0, 500) : null;
  const projectType = body?.project_type || null;
  if (projectType && !PROJECT_TYPES.includes(projectType)) return { error: "Invalid project_type" };

  let items;
  if (body?.items !== undefined || requireItems) {
    if (!Array.isArray(body?.items) || body.items.length === 0) return { error: "A template needs at least one task" };
    if (body.items.length > MAX_ITEMS) return { error: `A template can have at most ${MAX_ITEMS} tasks` };
    items = [];
    for (let i = 0; i < body.items.length; i += 1) {
      const it = body.items[i] ?? {};
      const title = String(it.title ?? "").trim();
      if (!title) return { error: `Task ${i + 1}: title is required` };
      if (title.length > 200) return { error: `Task ${i + 1}: title is too long (max 200)` };
      const priority = it.priority ?? "medium";
      if (!taskPriorities.includes(priority)) return { error: `Task ${i + 1}: invalid priority` };
      const offset = it.due_offset_days === undefined || it.due_offset_days === "" ? 0 : Number(it.due_offset_days);
      if (!Number.isInteger(offset) || offset < 0 || offset > 3650) return { error: `Task ${i + 1}: days after start must be a whole number from 0 to 3650` };
      const checklist = normalizeChecklist(it.checklist);
      if (checklist.error) return { error: `Task ${i + 1}: ${checklist.error}` };
      items.push({
        position: i,
        title,
        description: it.description ? String(it.description).trim().slice(0, 1000) : null,
        priority,
        due_offset_days: offset,
        checklist: checklist.value,
      });
    }
  }
  return { value: { name, description, project_type: projectType, items } };
}

export function normalizeChecklist(raw) {
  if (raw === undefined || raw === null) return { value: [] };
  if (!Array.isArray(raw)) return { error: "checklist must be a list" };
  const value = raw.map((s) => String(s ?? "").trim()).filter(Boolean);
  if (value.length > MAX_CHECKLIST) return { error: `checklist can have at most ${MAX_CHECKLIST} items` };
  if (value.some((s) => s.length > 200)) return { error: "a checklist item is too long (max 200)" };
  return { value };
}

async function insertTemplate(companyId, createdBy, { name, description, project_type, items }) {
  const { data: template, error } = await supabaseAdmin
    .from("task_templates")
    .insert({ company_id: companyId, name, description, project_type, created_by: createdBy })
    .select("*")
    .single();
  if (error) throw error;

  const { error: itemsError } = await supabaseAdmin
    .from("task_template_items")
    .insert(items.map((it) => ({ ...it, template_id: template.id })));
  if (itemsError) {
    await supabaseAdmin.from("task_templates").delete().eq("id", template.id); // never leave an empty template behind
    throw itemsError;
  }
  return template;
}

const defaultAsInput = (t) => ({
  name: t.name,
  description: t.description,
  project_type: t.project_type,
  items: t.items.map((it, position) => ({
    position,
    title: it.title,
    description: null,
    priority: it.priority ?? "medium",
    due_offset_days: it.offset,
    checklist: it.checklist ?? [],
  })),
});

/** Add the default templates whose names this company doesn't have yet. Returns how many were added. */
export async function addDefaultTemplates(companyId, createdBy = null) {
  const { data: existing, error } = await supabaseAdmin.from("task_templates").select("name").eq("company_id", companyId);
  if (error) throw error;
  const have = new Set((existing || []).map((t) => t.name));
  let added = 0;
  for (const t of DEFAULT_TEMPLATES) {
    if (have.has(t.name)) continue;
    await insertTemplate(companyId, createdBy, defaultAsInput(t));
    added += 1;
  }
  return added;
}

/**
 * First time a company opens templates, give it the defaults. The flag is claimed with a conditional
 * update first so two simultaneous requests can't both seed.
 */
export async function ensureDefaultTemplates(companyId) {
  const { data: claimed, error } = await supabaseAdmin
    .from("company")
    .update({ task_templates_seeded: true })
    .eq("id", companyId)
    .eq("task_templates_seeded", false)
    .select("id");
  if (error) throw error;
  if (!claimed || claimed.length === 0) return false;
  try {
    await addDefaultTemplates(companyId);
    return true;
  } catch (err) {
    await supabaseAdmin.from("company").update({ task_templates_seeded: false }).eq("id", companyId);
    throw err;
  }
}

export async function loadTemplates(companyId, templateId = null) {
  let query = supabaseAdmin.from("task_templates").select("*").eq("company_id", companyId).order("name", { ascending: true });
  if (templateId) query = query.eq("id", templateId);
  const { data: templates, error } = await query;
  if (error) throw error;
  if (!templates || templates.length === 0) return [];

  const { data: items, error: itemsError } = await supabaseAdmin
    .from("task_template_items")
    .select("*")
    .in("template_id", templates.map((t) => t.id))
    .order("position", { ascending: true });
  if (itemsError) throw itemsError;

  const byTemplate = {};
  for (const it of items || []) (byTemplate[it.template_id] ||= []).push(it);
  return templates.map((t) => ({ ...t, items: byTemplate[t.id] || [] }));
}

export { insertTemplate };

/** The task rows a template turns into for a project (pure, so it can be tested). */
export function buildTasksFromTemplate({ template, items, companyId, projectId, userId, startDate, assigneeId, basePosition = 0 }) {
  return items.map((it, i) => ({
    company_id: companyId,
    project_id: projectId,
    title: it.title,
    description: it.description ?? null,
    status: "todo",
    priority: it.priority,
    assignee_type: "team_member",
    assignee_id: assigneeId ?? null,
    due_date: addDays(startDate, it.due_offset_days ?? 0),
    position: basePosition + i,
    created_by: userId,
    source: "manual",
    template_id: template.id,
  }));
}

export const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export { todayStr };
