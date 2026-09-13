import { supabaseAdmin } from "../../db_connection.js";
import { getProjectForCompany, validateUserInCompany, projectMemberRoles } from "../lib/tasks.js";

const table = "project_members";

export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    const projectId = req.params.projectId;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const project = await getProjectForCompany(companyId, projectId, "id");
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id, user_id, role_in_project, allocation_percent, created_at")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const userIds = [...new Set((data || []).map((m) => m.user_id))];
    let nameById = {};
    if (userIds.length > 0) {
      const { data: users, error: usersErr } = await supabaseAdmin.from("users").select("id, name").in("id", userIds);
      if (usersErr) throw usersErr;
      nameById = Object.fromEntries((users || []).map((u) => [String(u.id), u.name]));
    }

    const members = (data || []).map((m) => ({
      id: m.id,
      user_id: m.user_id,
      user_name: nameById[String(m.user_id)] ?? null,
      role_in_project: m.role_in_project,
      allocation_percent: m.allocation_percent,
      added_at: m.created_at,
    }));

    return res.json({ members });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id || req.user?.sub;
    const projectId = req.params.projectId;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const project = await getProjectForCompany(companyId, projectId, "id");
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { user_id, role_in_project, allocation_percent } = req.body;
    if (!user_id) return res.status(400).json({ error: "user_id is required" });

    const belongs = await validateUserInCompany(companyId, user_id);
    if (!belongs) return res.status(400).json({ error: "Invalid user_id for this company" });

    if (role_in_project != null && !projectMemberRoles.includes(role_in_project)) {
      return res.status(400).json({ error: "Invalid role_in_project" });
    }

    let allocation = null;
    if (allocation_percent !== undefined && allocation_percent !== null) {
      allocation = Number(allocation_percent);
      if (!Number.isFinite(allocation) || allocation < 0 || allocation > 100) {
        return res.status(400).json({ error: "allocation_percent must be between 0 and 100" });
      }
    }

    const payload = {
      company_id: companyId,
      project_id: projectId,
      user_id,
      role_in_project: role_in_project ?? "contributor",
      allocation_percent: allocation,
      added_by: userId,
    };

    const { data, error } = await supabaseAdmin.from(table).insert(payload).select("*").single();
    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "User is already a member of this project" });
      }
      throw error;
    }

    return res.status(201).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const companyId = req.user?.company_id;
    const projectId = req.params.projectId;
    const memberId = req.params.memberId;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { role_in_project, allocation_percent } = req.body;

    if (role_in_project != null && !projectMemberRoles.includes(role_in_project)) {
      return res.status(400).json({ error: "Invalid role_in_project" });
    }

    let allocation;
    if (allocation_percent !== undefined && allocation_percent !== null) {
      allocation = Number(allocation_percent);
      if (!Number.isFinite(allocation) || allocation < 0 || allocation > 100) {
        return res.status(400).json({ error: "allocation_percent must be between 0 and 100" });
      }
    }

    const payload = {
      ...(role_in_project !== undefined ? { role_in_project } : {}),
      ...(allocation_percent !== undefined ? { allocation_percent: allocation } : {}),
    };
    const clean = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined));
    if (Object.keys(clean).length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(clean)
      .eq("id", memberId)
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

export async function remove(req, res) {
  try {
    const companyId = req.user?.company_id;
    const projectId = req.params.projectId;
    const memberId = req.params.memberId;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    // Deliberately not blocking on open assigned tasks here — the frontend surfaces
    // a warning instead of the backend hard-rejecting the removal.
    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("id", memberId)
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
