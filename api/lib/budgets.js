import { supabaseAdmin } from "../../db_connection.js";
import { NON_PNL_CATEGORIES, round1, round2, selectAll, selectIn } from "./db.js";
import { createNotifications } from "./notifications.js";

/**
 * Budget vs actual per project. "Actual" is what the project really cost, by the same rule as the
 * profitability report: its expenses (advances and equipment are not project cost) plus its supplier bills.
 * Warn at 80% of the budget, "over" from 100%.
 */
export const WARN_AT = 80;
export const OVER_AT = 100;

/** { percent, level: "ok" | "warn" | "over", remaining } for one project. */
export function budgetStatus(budget, actual) {
  const b = Number(budget);
  const a = Number(actual);
  const percent = b > 0 ? round1((a / b) * 100) : a > 0 ? 100 : 0;
  const level = b <= 0 ? (a > 0 ? "over" : "ok") : percent >= OVER_AT ? "over" : percent >= WARN_AT ? "warn" : "ok";
  return { percent, level, remaining: round2(b - a) };
}

/** Map of project id -> actual cost from expense and supplier-bill rows. */
export function projectCosts(expenses, bills) {
  const costs = new Map();
  const add = (projectId, amount) => costs.set(String(projectId), round2((costs.get(String(projectId)) ?? 0) + Number(amount ?? 0)));
  for (const e of expenses) if (e.project_id != null && !NON_PNL_CATEGORIES.includes(e.cost_category)) add(e.project_id, e.amount);
  for (const b of bills) if (b.project_id != null && b.status !== "cancelled") add(b.project_id, b.subtotal);
  return costs;
}

/** Budgeted projects with their actual cost, worst first. */
export async function loadBudgets(companyId, { includeDone = false, projectId = null } = {}) {
  let q = supabaseAdmin
    .from("projects")
    .select("id, title, status, client_id, budget_cost, budget_alert_level, due_date")
    .eq("company_id", companyId)
    .eq("is_test", false)
    .not("budget_cost", "is", null);
  if (projectId) q = q.eq("id", projectId);
  const { data: projects, error } = await q;
  if (error) throw error;

  const wanted = (projects || []).filter((p) => p.status !== "cancelled" && (includeDone || projectId || p.status !== "completed"));
  if (wanted.length === 0) return [];
  const ids = wanted.map((p) => p.id);

  const [expenses, bills, clientsRes] = await Promise.all([
    selectIn("expenses", "id, amount, cost_category, project_id", "project_id", ids, (q2) => q2.eq("company_id", companyId)),
    selectIn("vendor_bills", "id, subtotal, project_id, status", "project_id", ids, (q2) => q2.eq("company_id", companyId)),
    supabaseAdmin.from("clients").select("id, name").eq("company_id", companyId).in("id", [...new Set(wanted.map((p) => p.client_id))]),
  ]);
  if (clientsRes.error) throw clientsRes.error;
  const clientName = Object.fromEntries((clientsRes.data || []).map((c) => [String(c.id), c.name]));
  const costs = projectCosts(expenses, bills);

  return wanted
    .map((p) => {
      const actual = costs.get(String(p.id)) ?? 0;
      return {
        id: p.id,
        title: p.title,
        status: p.status,
        client_id: p.client_id,
        client_name: clientName[String(p.client_id)] ?? null,
        due_date: p.due_date,
        budget: Number(p.budget_cost),
        actual,
        alert_level: p.budget_alert_level,
        ...budgetStatus(p.budget_cost, actual),
      };
    })
    .sort((a, b) => b.percent - a.percent);
}

const LEVEL_NUMBER = { ok: 0, warn: 1, over: 2 };
const MANAGER_ROLES = ["owner", "admin", "manager"];

/**
 * Daily: when a live project crosses 80% or 100% of its budget, tell the managers once. The level already
 * announced is kept on the project (budget_alert_level); it also steps back down if the budget is raised.
 */
export async function runBudgetAlertJob() {
  const { data: projects, error } = await supabaseAdmin
    .from("projects")
    .select("id, company_id, title, budget_cost, budget_alert_level, status")
    .eq("is_test", false)
    .not("budget_cost", "is", null)
    .in("status", ["draft", "active", "on_hold"])
    .limit(2000);
  if (error) throw error;
  if (!projects || projects.length === 0) return { alerted: [] };

  const byCompany = new Map();
  for (const p of projects) (byCompany.get(p.company_id) ?? byCompany.set(p.company_id, []).get(p.company_id)).push(p);

  const rows = [];
  const alerted = [];
  for (const [companyId, list] of byCompany) {
    const ids = list.map((p) => p.id);
    const [expenses, bills, managersRes] = await Promise.all([
      selectIn("expenses", "id, amount, cost_category, project_id", "project_id", ids, (q) => q.eq("company_id", companyId)),
      selectIn("vendor_bills", "id, subtotal, project_id, status", "project_id", ids, (q) => q.eq("company_id", companyId)),
      supabaseAdmin.from("users").select("id, status").eq("company_id", companyId).in("role", MANAGER_ROLES),
    ]);
    if (managersRes.error) throw managersRes.error;
    const managers = (managersRes.data || []).filter((u) => u.status !== "blocked" && u.status !== "inactive");
    const costs = projectCosts(expenses, bills);

    for (const p of list) {
      const status = budgetStatus(p.budget_cost, costs.get(String(p.id)) ?? 0);
      const level = LEVEL_NUMBER[status.level];
      if (level === p.budget_alert_level) continue;

      if (level > p.budget_alert_level) {
        const over = level === 2;
        for (const m of managers) {
          rows.push({
            company_id: companyId,
            recipient_type: "team_member",
            recipient_id: m.id,
            type: "project_budget",
            title: over ? `Over budget: ${p.title}` : `Budget ${Math.floor(status.percent)}% used: ${p.title}`,
            body: over ? `Cost is ${status.percent}% of the ${Number(p.budget_cost)} budget` : `${status.remaining} left of the ${Number(p.budget_cost)} budget`,
            related_type: "project",
            related_id: p.id,
          });
        }
        alerted.push(p.id);
      }
      const { error: updateError } = await supabaseAdmin.from("projects").update({ budget_alert_level: level }).eq("id", p.id).eq("company_id", companyId);
      if (updateError) throw updateError;
    }
  }
  if (rows.length) await createNotifications(rows);
  return { alerted };
}

export { selectAll };
