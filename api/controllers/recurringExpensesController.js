import { supabaseAdmin } from "../../db_connection.js";
import { recurringExpenseTypes, recurringExpenseStatuses, addBillingCycle, todayStr, billingCycles } from "../lib/recurring.js";
import { getProjectForCompany } from "../lib/tasks.js";
import { chargeDueRecurringExpenses, expenseForCycle } from "../lib/recurringCharges.js";

const table = "recurring_expenses";
const expensesTable = "expenses";

async function enrich(companyId, rows) {
  if (!rows || rows.length === 0) return [];
  const projectIds = [...new Set(rows.map((r) => r.linked_project_id).filter(Boolean))];
  if (projectIds.length === 0) return rows.map((r) => ({ ...r, project_title: null }));

  const { data: projects, error } = await supabaseAdmin.from("projects").select("id, title").eq("company_id", companyId).in("id", projectIds);
  if (error) throw error;
  const projectTitleById = Object.fromEntries((projects || []).map((p) => [String(p.id), p.title]));

  return rows.map((r) => ({ ...r, project_title: r.linked_project_id ? projectTitleById[String(r.linked_project_id)] ?? null : null }));
}

export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    // Catch up on anything that fell due (idempotent) so the list is always current, cron or not.
    try {
      await chargeDueRecurringExpenses({ companyId });
    } catch (chargeErr) {
      console.error("[recurring-expenses] auto-charge failed:", chargeErr.message);
    }

    const { linked_project_id, status, page = "1", limit = "20" } = req.query;
    if (status && !recurringExpenseStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabaseAdmin
      .from(table)
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("next_due_date", { ascending: true })
      .range(from, to);
    if (linked_project_id) query = query.eq("linked_project_id", linked_project_id);
    if (status) query = query.eq("status", status);

    const { data, error, count } = await query;
    if (error) throw error;

    const items = await enrich(companyId, data || []);
    return res.json({ recurringExpenses: items, pagination: { page: pageNum, limit: limitNum, total: count ?? 0 } });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getOne(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data, error } = await supabaseAdmin.from(table).select("*").eq("id", req.params.id).eq("company_id", companyId).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    const [enriched] = await enrich(companyId, [data]);
    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { linked_project_id, type, name, amount, currency, billing_cycle, next_due_date, notes, auto_charge } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: "name is required" });
    if (!type || !recurringExpenseTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type (${recurringExpenseTypes.join(" | ")})` });
    }

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "amount must be a positive number" });

    if (!billing_cycle || !billingCycles.includes(billing_cycle)) {
      return res.status(400).json({ error: "Invalid billing_cycle (monthly | yearly)" });
    }
    if (!next_due_date || Number.isNaN(new Date(next_due_date).valueOf())) {
      return res.status(400).json({ error: "next_due_date is required and must be a valid date" });
    }

    if (linked_project_id) {
      const project = await getProjectForCompany(companyId, linked_project_id, "id");
      if (!project) return res.status(400).json({ error: "Invalid linked_project_id for this company" });
    }

    const payload = {
      company_id: companyId,
      linked_project_id: linked_project_id ?? null,
      type,
      name: String(name).trim(),
      amount: amt,
      currency: currency ? String(currency).trim() : undefined,
      billing_cycle,
      next_due_date,
      auto_charge: auto_charge === undefined ? undefined : Boolean(auto_charge),
      notes: notes ? String(notes).trim() : null,
    };
    const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));

    const { data, error } = await supabaseAdmin.from(table).insert(clean).select("*").single();
    if (error) throw error;

    const [enriched] = await enrich(companyId, [data]);
    return res.status(201).json(enriched);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", req.params.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) return res.status(404).json({ error: "Not found" });

    const { linked_project_id, type, name, amount, currency, billing_cycle, next_due_date, status, notes, auto_charge } = req.body;

    if (linked_project_id !== undefined && linked_project_id !== null) {
      const project = await getProjectForCompany(companyId, linked_project_id, "id");
      if (!project) return res.status(400).json({ error: "Invalid linked_project_id for this company" });
    }
    if (type !== undefined && !recurringExpenseTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type (${recurringExpenseTypes.join(" | ")})` });
    }
    let cleanAmount;
    if (amount !== undefined) {
      cleanAmount = Number(amount);
      if (!Number.isFinite(cleanAmount) || cleanAmount <= 0) {
        return res.status(400).json({ error: "amount must be a positive number" });
      }
    }
    if (billing_cycle !== undefined && !billingCycles.includes(billing_cycle)) {
      return res.status(400).json({ error: "Invalid billing_cycle (monthly | yearly)" });
    }
    if (status !== undefined && !recurringExpenseStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status (${recurringExpenseStatuses.join(" | ")})` });
    }
    if (next_due_date !== undefined && Number.isNaN(new Date(next_due_date).valueOf())) {
      return res.status(400).json({ error: "next_due_date must be a valid date" });
    }

    const payload = {
      ...(linked_project_id !== undefined ? { linked_project_id } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(cleanAmount !== undefined ? { amount: cleanAmount } : {}),
      ...(currency !== undefined ? { currency: String(currency).trim() } : {}),
      ...(billing_cycle !== undefined ? { billing_cycle } : {}),
      ...(next_due_date !== undefined ? { next_due_date } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(auto_charge !== undefined ? { auto_charge: Boolean(auto_charge) } : {}),
      ...(notes !== undefined ? { notes: notes ? String(notes).trim() : null } : {}),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(payload)
      .eq("id", req.params.id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    const [enriched] = await enrich(companyId, [data]);
    return res.json(enriched);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function remove(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data, error } = await supabaseAdmin
      .from(table)
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

export async function upcoming(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 365);
    const today = todayStr();
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "active")
      .gte("next_due_date", today)
      .lte("next_due_date", until)
      .order("next_due_date", { ascending: true });
    if (error) throw error;

    const items = await enrich(companyId, data || []);
    return res.json({ recurringExpenses: items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * recurring_expense_status has no 'overdue' value in the live enum (unlike recurring_revenue) —
 * "overdue" here is computed (active + next_due_date in the past), never a stored status.
 */
export async function overdue(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "active")
      .lt("next_due_date", todayStr())
      .order("next_due_date", { ascending: true });
    if (error) throw error;

    const items = await enrich(companyId, data || []);
    return res.json({ recurringExpenses: items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function markPaid(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", req.params.id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) return res.status(404).json({ error: "Not found" });
    if (existing.status === "cancelled") {
      return res.status(409).json({ error: "Cannot mark a cancelled recurring expense as paid" });
    }

    const today = todayStr();
    const { data: expense, error: expErr } = await supabaseAdmin
      .from(expensesTable)
      .insert(expenseForCycle(existing, today))
      .select("*")
      .single();
    if (expErr?.code === "23505") {
      return res.status(409).json({ error: "This subscription already has an expense recorded for today" });
    }
    if (expErr) throw expErr;

    const nextDueDate = addBillingCycle(existing.next_due_date, existing.billing_cycle);
    const { data, error } = await supabaseAdmin
      .from(table)
      .update({
        last_paid_date: today,
        next_due_date: nextDueDate,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;

    const [enriched] = await enrich(companyId, [data]);
    return res.json({ ...enriched, expense });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
