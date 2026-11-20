import { supabaseAdmin } from "../../db_connection.js";
import { ACCESS } from "../middleware/auth.js";
import { canSeeAllTasks } from "../lib/tasks.js";

const LIMIT = 5;
const MIN_LENGTH = 2;

/**
 * A search term made safe for PostgREST's `or=(...)` / `ilike` syntax: the characters that have a
 * meaning there (% _ , ( ) * " \\) become spaces, so user text can never alter the filter.
 */
export function cleanTerm(raw) {
  return String(raw ?? "")
    .replace(/[%_,()*"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

const EMPTY = { clients: [], projects: [], tasks: [], invoices: [], vendors: [], meetings: [] };

/**
 * GET /api/search?q=...
 * One box for everything: clients, projects, tasks, invoices, vendors, meetings. Company-scoped; people
 * only get what their role may open (invoices and vendors are finance; a member's tasks are their own).
 * Credentials are never searched.
 */
export async function search(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const term = cleanTerm(req.query.q);
    if (term.length < MIN_LENGTH) return res.json({ q: term, results: EMPTY });

    const like = `%${term}%`;
    const finance = ACCESS.finance.includes(req.user.role);
    const mine = !canSeeAllTasks(req.user);

    const tasksQuery = supabaseAdmin
      .from("tasks")
      .select("id, title, status, due_date, project_id")
      .eq("company_id", companyId)
      .ilike("title", like)
      .limit(LIMIT);

    const jobs = {
      clients: supabaseAdmin.from("clients").select("id, name, email, phone").eq("company_id", companyId).or(`name.ilike.${like},email.ilike.${like},phone.ilike.${like}`).limit(LIMIT),
      projects: supabaseAdmin.from("projects").select("id, title, status, type").eq("company_id", companyId).ilike("title", like).limit(LIMIT),
      tasks: mine ? tasksQuery.or(`assignee_id.eq.${req.user.id},created_by.eq.${req.user.id}`) : tasksQuery,
      invoices: finance
        ? supabaseAdmin.from("invoices").select("id, invoice_number, status, total_amount").eq("company_id", companyId).ilike("invoice_number", like).limit(LIMIT)
        : null,
      vendors: finance
        ? supabaseAdmin.from("vendors").select("id, name, email").eq("company_id", companyId).or(`name.ilike.${like},email.ilike.${like}`).limit(LIMIT)
        : null,
      meetings: supabaseAdmin.from("meetings").select("id, title, scheduled_at, project_id, status").eq("company_id", companyId).ilike("title", like).limit(LIMIT),
    };

    // One failing source must not blank the whole box.
    const keys = Object.keys(jobs);
    const settled = await Promise.allSettled(keys.map((k) => jobs[k] ?? Promise.resolve({ data: [] })));
    const results = {};
    settled.forEach((outcome, i) => {
      const key = keys[i];
      if (outcome.status === "fulfilled" && !outcome.value.error) results[key] = outcome.value.data || [];
      else {
        results[key] = [];
        console.error(`[search] ${key} failed:`, outcome.status === "rejected" ? outcome.reason?.message : outcome.value.error?.message);
      }
    });

    return res.json({ q: term, results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
