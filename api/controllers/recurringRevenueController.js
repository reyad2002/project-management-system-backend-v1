import { supabaseAdmin } from "../../db_connection.js";
import { recurringRevenueTypes, recurringRevenueStatuses, addBillingCycle, todayStr, billingCycles } from "../lib/recurring.js";
import { getProjectForCompany } from "../lib/tasks.js";

const table = "recurring_revenue";
const paymentsTable = "payments";

async function enrich(companyId, rows) {
  if (!rows || rows.length === 0) return [];
  const projectIds = [...new Set(rows.map((r) => r.project_id).filter(Boolean))];
  const clientIds = [...new Set(rows.map((r) => r.client_id).filter(Boolean))];

  const [projectsRes, clientsRes] = await Promise.all([
    projectIds.length
      ? supabaseAdmin.from("projects").select("id, title").eq("company_id", companyId).in("id", projectIds)
      : Promise.resolve({ data: [] }),
    clientIds.length ? supabaseAdmin.from("clients").select("id, name").in("id", clientIds) : Promise.resolve({ data: [] }),
  ]);
  if (projectsRes.error) throw projectsRes.error;
  if (clientsRes.error) throw clientsRes.error;

  const projectTitleById = Object.fromEntries((projectsRes.data || []).map((p) => [String(p.id), p.title]));
  const clientNameById = Object.fromEntries((clientsRes.data || []).map((c) => [String(c.id), c.name]));

  return rows.map((r) => ({
    ...r,
    project_title: r.project_id ? projectTitleById[String(r.project_id)] ?? null : null,
    client_name: clientNameById[String(r.client_id)] ?? null,
  }));
}

async function validateClientInCompany(companyId, clientId) {
  const { data, error } = await supabaseAdmin.from("clients").select("id").eq("id", clientId).eq("company_id", companyId).maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { project_id, client_id, status, page = "1", limit = "20" } = req.query;
    if (status && !recurringRevenueStatuses.includes(status)) {
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
      .order("next_renewal_date", { ascending: true })
      .range(from, to);
    if (project_id) query = query.eq("project_id", project_id);
    if (client_id) query = query.eq("client_id", client_id);
    if (status) query = query.eq("status", status);

    const { data, error, count } = await query;
    if (error) throw error;

    const items = await enrich(companyId, data || []);
    return res.json({ recurringRevenue: items, pagination: { page: pageNum, limit: limitNum, total: count ?? 0 } });
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

    const { client_id, project_id, type, amount, currency, billing_cycle, next_renewal_date, notes } = req.body;
    if (!client_id) return res.status(400).json({ error: "client_id is required" });
    if (!type || !recurringRevenueTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type (${recurringRevenueTypes.join(" | ")})` });
    }

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) return res.status(400).json({ error: "amount must be a positive number" });

    if (!billing_cycle || !billingCycles.includes(billing_cycle)) {
      return res.status(400).json({ error: "Invalid billing_cycle (monthly | yearly)" });
    }
    if (!next_renewal_date || Number.isNaN(new Date(next_renewal_date).valueOf())) {
      return res.status(400).json({ error: "next_renewal_date is required and must be a valid date" });
    }

    const clientOk = await validateClientInCompany(companyId, client_id);
    if (!clientOk) return res.status(400).json({ error: "Invalid client_id for this company" });

    if (project_id) {
      const project = await getProjectForCompany(companyId, project_id, "id, client_id");
      if (!project) return res.status(400).json({ error: "Invalid project_id for this company" });
      if (String(project.client_id) !== String(client_id)) {
        return res.status(400).json({ error: "project_id does not belong to client_id" });
      }
    }

    const payload = {
      company_id: companyId,
      client_id,
      project_id: project_id ?? null,
      type,
      amount: amt,
      currency: currency ? String(currency).trim() : undefined,
      billing_cycle,
      next_renewal_date,
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

    const { client_id, project_id, type, amount, currency, billing_cycle, next_renewal_date, status, notes } = req.body;

    const finalClientId = client_id !== undefined ? client_id : existing.client_id;
    if (client_id !== undefined) {
      const clientOk = await validateClientInCompany(companyId, client_id);
      if (!clientOk) return res.status(400).json({ error: "Invalid client_id for this company" });
    }
    if (project_id !== undefined && project_id !== null) {
      const project = await getProjectForCompany(companyId, project_id, "id, client_id");
      if (!project) return res.status(400).json({ error: "Invalid project_id for this company" });
      if (String(project.client_id) !== String(finalClientId)) {
        return res.status(400).json({ error: "project_id does not belong to client_id" });
      }
    }
    if (type !== undefined && !recurringRevenueTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid type (${recurringRevenueTypes.join(" | ")})` });
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
    if (status !== undefined && !recurringRevenueStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    if (next_renewal_date !== undefined && Number.isNaN(new Date(next_renewal_date).valueOf())) {
      return res.status(400).json({ error: "next_renewal_date must be a valid date" });
    }

    const payload = {
      ...(client_id !== undefined ? { client_id } : {}),
      ...(project_id !== undefined ? { project_id } : {}),
      ...(type !== undefined ? { type } : {}),
      ...(cleanAmount !== undefined ? { amount: cleanAmount } : {}),
      ...(currency !== undefined ? { currency: String(currency).trim() } : {}),
      ...(billing_cycle !== undefined ? { billing_cycle } : {}),
      ...(next_renewal_date !== undefined ? { next_renewal_date } : {}),
      ...(status !== undefined ? { status } : {}),
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
      .neq("status", "cancelled")
      .gte("next_renewal_date", today)
      .lte("next_renewal_date", until)
      .order("next_renewal_date", { ascending: true });
    if (error) throw error;

    const items = await enrich(companyId, data || []);
    return res.json({ recurringRevenue: items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function overdue(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("company_id", companyId)
      .eq("status", "overdue")
      .order("next_renewal_date", { ascending: true });
    if (error) throw error;

    const items = await enrich(companyId, data || []);
    return res.json({ recurringRevenue: items });
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
      return res.status(409).json({ error: "Cannot mark a cancelled recurring revenue record as paid" });
    }

    const today = todayStr();
    const { data: payment, error: payErr } = await supabaseAdmin
      .from(paymentsTable)
      .insert({
        company_id: companyId,
        project_id: existing.project_id, // nullable on payments? see note below
        amount: existing.amount,
        payment_date: today,
        payment_method: "bank_transfer",
        type: "advance",
        notes: `Recurring revenue payment (${existing.type}), recurring_revenue #${existing.id}`,
      })
      .select("*")
      .single();
    if (payErr) throw payErr;

    const nextRenewalDate = addBillingCycle(existing.next_renewal_date, existing.billing_cycle);
    const { data, error } = await supabaseAdmin
      .from(table)
      .update({
        last_paid_date: today,
        next_renewal_date: nextRenewalDate,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;

    const [enriched] = await enrich(companyId, [data]);
    return res.json({ ...enriched, payment });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
