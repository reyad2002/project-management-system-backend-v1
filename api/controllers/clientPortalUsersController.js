import crypto from "crypto";
import { supabaseAdmin } from "../../db_connection.js";

const table = "client_portal_users";
const clientsTable = "clients";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Placeholder for actual delivery (SMTP/Resend/SendGrid, etc.) — no email provider is
 * configured in this project yet, so this only logs. Wire a real provider here later.
 */
function sendPortalInviteEmail(email, name, token) {
  console.log(`[portal-invite] would email ${email} (${name}) invite token: ${token}`);
}

export async function list(req, res) {
  try {
    const companyId = req.user?.company_id;
    const clientId = req.params.clientId;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data: client, error: clientErr } = await supabaseAdmin
      .from(clientsTable)
      .select("id")
      .eq("id", clientId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (clientErr) throw clientErr;
    if (!client) return res.status(404).json({ error: "Client not found" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .select("id, name, email, status, last_login_at, created_at")
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    return res.json({ portalUsers: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const companyId = req.user?.company_id;
    const userId = req.user?.id || req.user?.sub;
    const clientId = req.params.clientId;
    if (!companyId || !userId) return res.status(401).json({ error: "Not authenticated" });

    const { data: client, error: clientErr } = await supabaseAdmin
      .from(clientsTable)
      .select("id")
      .eq("id", clientId)
      .eq("company_id", companyId)
      .maybeSingle();
    if (clientErr) throw clientErr;
    if (!client) return res.status(404).json({ error: "Client not found" });

    const { name, email } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name is required" });
    }
    if (!email || !String(email).trim()) {
      return res.status(400).json({ error: "email is required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const inviteToken = crypto.randomUUID();
    const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

    const payload = {
      company_id: companyId,
      client_id: clientId,
      name: String(name).trim(),
      email: normalizedEmail,
      status: "invited",
      invite_token: inviteToken,
      invite_expires_at: inviteExpiresAt,
      invited_by: userId,
    };

    const { data, error } = await supabaseAdmin
      .from(table)
      .insert(payload)
      .select("id, name, email, status, invite_expires_at, created_at")
      .single();
    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "Portal user already invited for this email" });
      }
      throw error;
    }

    sendPortalInviteEmail(normalizedEmail, data.name, inviteToken);

    const response = { ...data };
    if (process.env.NODE_ENV !== "production") {
      response.invite_token = inviteToken; // dev convenience only
    }

    return res.status(201).json(response);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function remove(req, res) {
  try {
    const companyId = req.user?.company_id;
    const clientId = req.params.clientId;
    const id = req.params.id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data, error } = await supabaseAdmin
      .from(table)
      .delete()
      .eq("id", id)
      .eq("company_id", companyId)
      .eq("client_id", clientId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Not found" });

    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
