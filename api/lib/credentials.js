import { supabaseAdmin } from "../../db_connection.js";
import { decrypt } from "./crypto.js";

const table = "credentials";
const accessLogTable = "credential_access_logs";
export const credentialSafeFields = "id, project_id, label, username, panel_url, notes, created_at";

export async function getCredentialForCompany(companyId, credentialId) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("*")
    .eq("id", credentialId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listCredentialsForProject(companyId, projectId) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(credentialSafeFields)
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * credential_access_logs is append-only audit trail — never update/delete these rows.
 */
export async function logCredentialAccess(credentialId, accessedByType, accessedById) {
  const { error } = await supabaseAdmin
    .from(accessLogTable)
    .insert({ credential_id: credentialId, accessed_by_type: accessedByType, accessed_by_id: accessedById });
  if (error) throw error;
}

export function revealCredentialPassword(credentialRow) {
  return decrypt(credentialRow.password_encrypted);
}
