import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../../db_connection.js";
import { writeAudit } from "../lib/audit.js";

const table = "client_portal_users";

export async function acceptInvite(req, res) {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ error: "token and password are required" });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: "password must be at least 8 characters" });
    }

    const { data: portalUser, error } = await supabaseAdmin
      .from(table)
      .select("id, company_id, name, invite_token, invite_expires_at, status")
      .eq("invite_token", token)
      .maybeSingle();
    if (error) throw error;

    if (!portalUser) {
      return res.status(400).json({ error: "Invalid invite token" });
    }
    if (!portalUser.invite_expires_at || new Date(portalUser.invite_expires_at) < new Date()) {
      return res.status(400).json({ error: "Invite link has expired" });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const { error: updateErr } = await supabaseAdmin
      .from(table)
      .update({
        password_hash: passwordHash,
        status: "active",
        invite_token: null,
        invite_expires_at: null,
      })
      .eq("id", portalUser.id);
    if (updateErr) throw updateErr;

    await writeAudit(req, {
      company_id: portalUser.company_id,
      actor_type: "client_portal_user",
      actor_id: portalUser.id,
      actor_name: portalUser.name,
      action: "accept_invite",
      entity_type: "client_portal_user",
      entity_id: portalUser.id,
      status_code: 200,
      summary: `${portalUser.name} accepted the portal invite`,
    });

    return res.json({ message: "Account activated. You can now log in." });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function login(req, res) {
  try {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(503).json({ error: "Auth not configured (JWT_SECRET)" });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const { data: rows, error } = await supabaseAdmin
      .from(table)
      .select("id, company_id, client_id, name, email, password_hash, status")
      .eq("email", normalizedEmail)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw error;

    const portalUser = rows?.[0];
    if (!portalUser || portalUser.status !== "active" || !portalUser.password_hash) {
      await writeAudit(req, {
        company_id: portalUser?.company_id,
        actor_type: "anonymous",
        action: "portal_login_failed",
        entity_type: "client_portal_user",
        entity_id: portalUser?.id,
        outcome: "failure",
        status_code: 401,
        summary: `Failed portal login for ${normalizedEmail}`,
        metadata: { email: normalizedEmail },
      });
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, portalUser.password_hash);
    if (!valid) {
      await writeAudit(req, {
        company_id: portalUser.company_id,
        actor_type: "anonymous",
        action: "portal_login_failed",
        entity_type: "client_portal_user",
        entity_id: portalUser.id,
        outcome: "failure",
        status_code: 401,
        summary: `Failed portal login (wrong password) for ${portalUser.name}`,
        metadata: { email: normalizedEmail },
      });
      return res.status(401).json({ error: "Invalid email or password" });
    }

    await supabaseAdmin
      .from(table)
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", portalUser.id);

    await writeAudit(req, {
      company_id: portalUser.company_id,
      actor_type: "client_portal_user",
      actor_id: portalUser.id,
      actor_name: portalUser.name,
      action: "portal_login",
      entity_type: "client_portal_user",
      entity_id: portalUser.id,
      status_code: 200,
      summary: `${portalUser.name} logged in to the client portal`,
    });

    const token = jwt.sign(
      { sub: portalUser.id, client_id: portalUser.client_id, scope: "portal" },
      secret,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? "1d" }
    );

    const { password_hash: _, ...portalUserSafe } = portalUser;

    return res.json({ portalUser: portalUserSafe, token });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function getMe(req, res) {
  try {
    if (!req.portalUser) return res.status(401).json({ error: "Not authenticated" });

    const { data: client, error } = await supabaseAdmin
      .from("clients")
      .select("id, name")
      .eq("id", req.portalUser.client_id)
      .maybeSingle();
    if (error) throw error;

    return res.json({ ...req.portalUser, client });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function logout(req, res) {
  return res.json({ message: "Logged out successfully" });
}
