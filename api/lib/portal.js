import { supabaseAdmin } from "../../db_connection.js";

/**
 * Shared "does this project belong to the current portal user's client" check, used by every
 * portal read/write endpoint scoped to a project (meetings, links, tasks, credentials,
 * feedback, projects/phases/invoices). A client can never see or act on another client's
 * project, even by guessing an id, because this always filters on both company_id and client_id.
 */
export async function getPortalProject(companyId, clientId, projectId, fields = "id") {
  const { data, error } = await supabaseAdmin
    .from("projects")
    .select(fields)
    .eq("id", projectId)
    .eq("company_id", companyId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
