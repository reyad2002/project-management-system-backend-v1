import { supabaseAdmin } from "../../db_connection.js";

const table = "expenses";
const projectsTable = "projects";
const phasesTable = "phases";
const expenseTypes = ["direct", "operational"];
const costCategories = [
  "labor",
  "materials",
  "subcontractor",
  "software",
  "travel",
  "marketing",
  "rent",
  "utilities",
  "other",
  "salary",
  "ad_spend",
  "equipment",
  "legal",
  "bank_fees",
  "advance",
];

/**
 * Ensure phase_id (if provided) belongs to project_id (if provided).
 * Returns { valid: true } or { valid: false, error }.
 */
async function validatePhaseBelongsToProject(companyId, projectId, phaseId) {
  if (!phaseId) return { valid: true };
  if (!projectId) {
    return { valid: false, error: "Phase does not belong to the specified project" };
  }
  const { data, error } = await supabaseAdmin
    .from(phasesTable)
    .select("id")
    .eq("id", phaseId)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return { valid: false, error: "Phase does not belong to the specified project" };
  }
  return { valid: true };
}

export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const {
      type,
      q,
      from_date,
      to_date,
      project_id,
      vendor_id,
      cost_category,
      page = "1",
      limit = "20",
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    let query = supabaseAdmin
      .from(table)
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);

    // type filter
    if (type && String(type).trim()) {
      const t = String(type).trim();
      if (!expenseTypes.includes(t)) {
        return res
          .status(400)
          .json({ error: "Invalid type (direct | operational)" });
      }
      query = query.eq("type", t);
    }

    if (project_id) query = query.eq("project_id", project_id);
    if (vendor_id) query = query.eq("vendor_id", vendor_id);
    if (cost_category) {
      const c = String(cost_category).trim();
      if (!costCategories.includes(c)) {
        return res.status(400).json({ error: "Invalid cost_category" });
      }
      query = query.eq("cost_category", c);
    }

    // optional date range
    if (from_date) query = query.gte("expense_date", from_date);
    if (to_date) query = query.lte("expense_date", to_date);

    // optional search on title/description
    if (q && String(q).trim()) {
      const term = String(q).trim();
      query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
    }

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({
      expenses: data || [],
      pagination: { page: pageNum, limit: limitNum, total: count ?? 0 },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getOne(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;

    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("*")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.json(data);
  } catch (err) {
    res
      .status(err.code === "PGRST116" ? 404 : 500)
      .json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const {
      amount,
      expense_date,
      title,
      description,
      type,
      project_id,
      phase_id,
      vendor_id,
      cost_category,
    } = req.body;

    // validate amount (allow negative values)
    const amt = Number(amount);
    if (!Number.isFinite(amt)) {
      return res.status(400).json({ error: "amount must be a valid number" });
    }

    if (!type) {
      return res.status(400).json({ error: "type is required" });
    }

    // validate type (recommended)
    if (type != null && !expenseTypes.includes(type)) {
      return res
        .status(400)
        .json({ error: "Invalid type (direct | operational)" });
    }

    // A direct cost is by definition a cost of delivering a specific project; without a project
    // it can never reach project profitability. Company-wide costs are "operational".
    if (type === "direct" && !project_id) {
      return res.status(400).json({
        error: "Direct expenses must be linked to a project. Use 'operational' for company-wide costs.",
      });
    }

    // validate title (recommended)
    if (!title || !String(title).trim()) {
      return res.status(400).json({ error: "title is required" });
    }

    if (cost_category != null && !costCategories.includes(cost_category)) {
      return res.status(400).json({ error: "Invalid cost_category" });
    }

    // project_id / vendor_id ownership checks (if provided)
    if (project_id) {
      const { data: project, error: projectErr } = await supabaseAdmin
        .from(projectsTable)
        .select("id")
        .eq("id", project_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (projectErr) throw projectErr;
      if (!project) {
        return res.status(400).json({ error: "Invalid project_id for this company" });
      }
    }

    const phaseCheck = await validatePhaseBelongsToProject(companyId, project_id, phase_id);
    if (!phaseCheck.valid) {
      return res.status(400).json({ error: phaseCheck.error });
    }

    const payload = {
      company_id: companyId,
      amount: amt,
      expense_date: expense_date ?? new Date().toISOString().slice(0, 10), // default today YYYY-MM-DD
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      type: type ?? expenseTypes[0], // default if you want
      project_id: project_id ?? null,
      phase_id: phase_id ?? null,
      vendor_id: vendor_id ?? null,
      cost_category: cost_category ?? "other",
    };

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(payload)
      .select("*")
      .single();

    if (error) throw error;

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;

    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    if (!id) return res.status(400).json({ error: "Missing id" });

    const {
      amount,
      expense_date,
      title,
      description,
      type,
      project_id,
      phase_id,
      vendor_id,
      cost_category,
    } = req.body;

    const { data: existing, error: existingErr } = await supabaseAdmin
      .from(table)
      .select("id, project_id, phase_id, type")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (!existing) return res.status(404).json({ error: "Not found" });

    // validate amount only if provided
    let cleanAmount;
    if (amount !== undefined) {
      const amt = Number(amount);
      if (!Number.isFinite(amt)) {
        return res.status(400).json({ error: "amount must be a valid number" });
      }
      cleanAmount = amt;
    }

    // validate type only if provided
    if (type !== undefined && type !== null) {
      const t = String(type).trim();
      if (!expenseTypes.includes(t)) {
        return res
          .status(400)
          .json({ error: "Invalid type (direct | operational)" });
      }
    }

    if (cost_category !== undefined && cost_category !== null && !costCategories.includes(cost_category)) {
      return res.status(400).json({ error: "Invalid cost_category" });
    }

    if (project_id !== undefined && project_id !== null) {
      const { data: project, error: projectErr } = await supabaseAdmin
        .from(projectsTable)
        .select("id")
        .eq("id", project_id)
        .eq("company_id", companyId)
        .maybeSingle();
      if (projectErr) throw projectErr;
      if (!project) {
        return res.status(400).json({ error: "Invalid project_id for this company" });
      }
    }

    // resolve final project/phase to validate phase-belongs-to-project relationship
    const finalProjectId = project_id !== undefined ? project_id : existing.project_id;
    const finalPhaseId = phase_id !== undefined ? phase_id : existing.phase_id;
    const finalType = type !== undefined && type !== null ? String(type).trim() : existing.type;
    if (finalType === "direct" && !finalProjectId) {
      return res.status(400).json({
        error: "Direct expenses must be linked to a project. Pick a project, or change the type to 'operational'.",
      });
    }
    if (finalPhaseId) {
      const phaseCheck = await validatePhaseBelongsToProject(companyId, finalProjectId, finalPhaseId);
      if (!phaseCheck.valid) {
        return res.status(400).json({ error: phaseCheck.error });
      }
    }

    const payload = {
      ...(cleanAmount !== undefined ? { amount: cleanAmount } : {}),
      ...(expense_date !== undefined ? { expense_date } : {}),
      ...(title !== undefined
        ? { title: title ? String(title).trim() : null }
        : {}),
      ...(description !== undefined
        ? { description: description ? String(description).trim() : null }
        : {}),
      ...(type !== undefined
        ? { type: type ? String(type).trim() : null }
        : {}),
      ...(project_id !== undefined ? { project_id } : {}),
      ...(phase_id !== undefined ? { phase_id } : {}),
      ...(vendor_id !== undefined ? { vendor_id } : {}),
      ...(cost_category !== undefined ? { cost_category } : {}),
    };

    const clean = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined),
    );

    if (Object.keys(clean).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(clean)
      .eq("id", id)
      .eq("company_id", companyId)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function remove(req, res) {
  try {
    const companyId = req.user?.company_id;
    const id = req.params.id;

    if (!companyId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
