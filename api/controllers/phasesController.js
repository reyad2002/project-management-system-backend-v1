import { supabaseAdmin } from "../../db_connection.js";

const table = "phases";
const projectsTable = "projects";

/**
 * Ensure phase start_date and end_date fall within project start_date and due_date.
 */
function validatePhaseDatesInProjectRange(phaseStart, phaseEnd, projectStart, projectDue) {
  const ps = projectStart ? new Date(projectStart) : null;
  const pd = projectDue ? new Date(projectDue) : null;
  const pStart = phaseStart ? new Date(phaseStart) : null;
  const pEnd = phaseEnd ? new Date(phaseEnd) : null;

  if (!pStart || !pEnd) return { valid: true };
  if (Number.isNaN(pStart.valueOf()) || Number.isNaN(pEnd.valueOf())) {
    return { valid: false, error: "Invalid phase dates" };
  }
  if (pEnd < pStart) {
    return { valid: false, error: "Phase end_date must be on or after start_date" };
  }

  if (ps != null && !Number.isNaN(ps.valueOf()) && pStart < ps) {
    return { valid: false, error: "Phase start_date must be on or after project start_date" };
  }
  if (pd != null && !Number.isNaN(pd.valueOf()) && pEnd > pd) {
    return { valid: false, error: "Phase end_date must be on or before project due_date" };
  }
  return { valid: true };
}

/**
 * Get project and current sum of phase amounts (excluding optional phaseId).
 */
async function getProjectAndPhaseTotal(companyId, projectId, excludePhaseId = null) {
  const { data: project, error: projectErr } = await supabaseAdmin
    .from(projectsTable)
    .select("id, start_date, due_date, price")
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle();

  if (projectErr) throw projectErr;
  if (!project) return { project: null, phaseTotal: 0 };

  let phaseQuery = supabaseAdmin
    .from(table)
    .select("amount")
    .eq("company_id", companyId)
    .eq("project_id", projectId);

  if (excludePhaseId) {
    phaseQuery = phaseQuery.neq("id", excludePhaseId);
  }
  const { data: phases, error: phasesErr } = await phaseQuery;
  if (phasesErr) throw phasesErr;
  const phaseTotal = (phases || []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

  return { project, phaseTotal };
}

/**
 * Ensure project exists and belongs to company. Returns project or null.
 */
async function getProject(companyId, projectId) {
  const { data, error } = await supabaseAdmin
    .from(projectsTable)
    .select("id, start_date, due_date, price")
    .eq("id", projectId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Ensure phase exists, belongs to company and to the given project.
 */
async function getPhaseForProject(companyId, projectId, phaseId) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("*")
    .eq("id", phaseId)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ----- All operations are scoped by project id (req.params.id = project id) -----

/**
 * GET /api/projects/:id/phases - List phases for project
 */
export async function listByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const projectId = req.params.id;

    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    if (!projectId) return res.status(400).json({ error: "Missing project id" });

    const project = await getProject(companyId, projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { page = "1", limit = "20" } = req.query;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const from = (pageNum - 1) * limitNum;
    const to = from + limitNum - 1;

    const { data, error, count } = await supabaseAdmin
      .from(table)
      .select("*", { count: "exact" })
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .order("start_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    return res.json({
      phases: data ?? [],
      pagination: { page: pageNum, limit: limitNum, total: count ?? 0 },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/projects/:id/phases/:phaseId - Get one phase (must belong to project)
 */
export async function getOneByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const projectId = req.params.id;
    const phaseId = req.params.phaseId;

    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    if (!projectId) return res.status(400).json({ error: "Missing project id" });
    if (!phaseId) return res.status(400).json({ error: "Missing phase id" });

    const phase = await getPhaseForProject(companyId, projectId, phaseId);
    if (!phase) return res.status(404).json({ error: "Phase not found" });

    return res.json(phase);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/projects/:id/phases - Create phase (project id from URL)
 */
export async function createByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const projectId = req.params.id;

    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    if (!projectId) return res.status(400).json({ error: "Missing project id" });

    const project = await getProject(companyId, projectId);
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { start_date, end_date, amount, title, notes } = req.body;

    const amt = amount != null ? Number(amount) : 0;
    if (!Number.isFinite(amt) || amt < 0) {
      return res.status(400).json({ error: "amount must be a non-negative number" });
    }

    const { phaseTotal } = await getProjectAndPhaseTotal(companyId, projectId);

    const dateCheck = validatePhaseDatesInProjectRange(
      start_date,
      end_date,
      project.start_date,
      project.due_date
    );
    if (!dateCheck.valid) {
      return res.status(400).json({ error: dateCheck.error });
    }

    const projectPrice = Number(project.price ?? 0);
    if (projectPrice > 0 && phaseTotal + amt > projectPrice) {
      return res.status(400).json({
        error: `Total phase amount would exceed project price. Project price: ${projectPrice}, current phases total: ${phaseTotal}, remaining: ${projectPrice - phaseTotal}`,
      });
    }

    const payload = {
      company_id: companyId,
      project_id: projectId,
      start_date: start_date ?? null,
      end_date: end_date ?? null,
      amount: amt,
      title: title ? String(title).trim() : null,
      notes: notes ? String(notes).trim() : null,
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

/**
 * PUT /api/projects/:id/phases/:phaseId - Update phase (must belong to project)
 */
export async function updateByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const projectId = req.params.id;
    const phaseId = req.params.phaseId;

    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    if (!projectId) return res.status(400).json({ error: "Missing project id" });
    if (!phaseId) return res.status(400).json({ error: "Missing phase id" });

    const existing = await getPhaseForProject(companyId, projectId, phaseId);
    if (!existing) return res.status(404).json({ error: "Phase not found" });

    const { start_date, end_date, amount, title, notes } = req.body;

    const finalStart = start_date !== undefined ? start_date : existing.start_date;
    const finalEnd = end_date !== undefined ? end_date : existing.end_date;
    const finalAmount = amount !== undefined ? Number(amount) : Number(existing.amount ?? 0);

    if (amount !== undefined && (!Number.isFinite(finalAmount) || finalAmount < 0)) {
      return res.status(400).json({ error: "amount must be a non-negative number" });
    }

    const { project, phaseTotal } = await getProjectAndPhaseTotal(
      companyId,
      projectId,
      phaseId
    );
    if (!project) return res.status(404).json({ error: "Project not found" });

    const dateCheck = validatePhaseDatesInProjectRange(
      finalStart,
      finalEnd,
      project.start_date,
      project.due_date
    );
    if (!dateCheck.valid) {
      return res.status(400).json({ error: dateCheck.error });
    }

    const projectPrice = Number(project.price ?? 0);
    if (projectPrice > 0 && phaseTotal + finalAmount > projectPrice) {
      return res.status(400).json({
        error: `Total phase amount would exceed project price. Project price: ${projectPrice}, other phases total: ${phaseTotal}, remaining: ${projectPrice - phaseTotal}`,
      });
    }

    const payload = {
      ...(start_date !== undefined ? { start_date: finalStart } : {}),
      ...(end_date !== undefined ? { end_date: finalEnd } : {}),
      ...(amount !== undefined ? { amount: finalAmount } : {}),
      ...(title !== undefined ? { title: title ? String(title).trim() : null } : {}),
      ...(notes !== undefined ? { notes: notes ? String(notes).trim() : null } : {}),
    };
    const clean = Object.fromEntries(
      Object.entries(payload).filter(([, v]) => v !== undefined)
    );
    if (Object.keys(clean).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(clean)
      .eq("id", phaseId)
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /api/projects/:id/phases/:phaseId - Delete phase (must belong to project)
 */
export async function removeByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const projectId = req.params.id;
    const phaseId = req.params.phaseId;

    if (!companyId) return res.status(401).json({ error: "Not authenticated" });
    if (!projectId) return res.status(400).json({ error: "Missing project id" });
    if (!phaseId) return res.status(400).json({ error: "Missing phase id" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("id", phaseId)
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Phase not found" });
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
