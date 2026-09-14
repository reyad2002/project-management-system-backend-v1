import { supabaseAdmin } from "../../db_connection.js";
import { getProjectForCompany } from "../lib/tasks.js";
import { getPortalProject } from "../lib/portal.js";

const table = "feedback";
const relatedTypes = ["meeting", "phase"];

async function validateRelatedBelongsToProject(companyId, projectId, relatedType, relatedId) {
  const relatedTable = relatedType === "meeting" ? "meetings" : "phases";
  const { data, error } = await supabaseAdmin
    .from(relatedTable)
    .select("id")
    .eq("id", relatedId)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

// ----- Dashboard -----

export async function listByProject(req, res) {
  try {
    const companyId = req.user?.company_id;
    const projectId = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const project = await getProjectForCompany(companyId, projectId, "id");
    if (!project) return res.status(404).json({ error: "Project not found" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id, related_type, related_id, rating, submitted_by, created_at")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const rows = data || [];
    const submitterIds = [...new Set(rows.map((r) => r.submitted_by))];
    let nameById = {};
    if (submitterIds.length > 0) {
      const { data: users, error: usersErr } = await supabaseAdmin
        .from("client_portal_users")
        .select("id, name")
        .in("id", submitterIds);
      if (usersErr) throw usersErr;
      nameById = Object.fromEntries((users || []).map((u) => [String(u.id), u.name]));
    }

    const feedback = rows.map((r) => ({
      id: r.id,
      related_type: r.related_type,
      related_id: r.related_id,
      rating: r.rating,
      submitted_by_name: nameById[String(r.submitted_by)] ?? null,
      created_at: r.created_at,
    }));

    const averageRating =
      rows.length > 0 ? Math.round((rows.reduce((sum, r) => sum + r.rating, 0) / rows.length) * 100) / 100 : null;

    return res.json({ feedback, averageRating });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// ----- Portal -----

export async function portalSubmit(req, res) {
  try {
    const { company_id: companyId, client_id: clientId, id: portalUserId } = req.portalUser;
    const { project_id, related_type, related_id, rating } = req.body;

    if (!project_id) return res.status(400).json({ error: "project_id is required" });
    if (!relatedTypes.includes(related_type)) return res.status(400).json({ error: "Invalid related_type" });
    if (!related_id) return res.status(400).json({ error: "related_id is required" });
    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: "rating must be an integer between 1 and 5" });
    }

    const project = await getPortalProject(companyId, clientId, project_id);
    if (!project) return res.status(404).json({ error: "Not found" });

    const belongs = await validateRelatedBelongsToProject(companyId, project_id, related_type, related_id);
    if (!belongs) return res.status(400).json({ error: "related_id does not belong to project_id" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .upsert(
        {
          company_id: companyId,
          project_id,
          related_type,
          related_id,
          rating: ratingNum,
          submitted_by: portalUserId,
        },
        { onConflict: "related_type,related_id,submitted_by" }
      )
      .select("*")
      .single();
    if (error) throw error;

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
