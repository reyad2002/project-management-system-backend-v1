import crypto from "crypto";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "../../db_connection.js";
import { ROLES } from "../middleware/auth.js";

const table = "users";
const selectFields = "id, created_at, name, email, role, status, must_change_password, last_login_at";
const statuses = ["active", "inactive", "blocked"];

/**
 * Who may manage whom. An owner manages everyone; an admin manages only the roles below admin, so
 * an admin can never grant themselves (or anyone) owner/admin rights, or lock an owner out.
 */
const MANAGEABLE = {
  owner: ROLES,
  admin: ["manager", "accountant", "member"],
};

function canManage(actorRole, targetRole) {
  return (MANAGEABLE[actorRole] ?? []).includes(targetRole);
}

function generateTemporaryPassword() {
  // 14 chars from a 64-char alphabet ≈ 84 bits; shown once, must be changed at first login.
  return crypto.randomBytes(11).toString("base64url").slice(0, 14);
}

async function activeOwnerCount(companyId, excludeUserId) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select("id")
    .eq("company_id", companyId)
    .eq("role", "owner")
    .eq("status", "active")
    .neq("id", excludeUserId);
  if (error) throw error;
  return (data || []).length;
}

async function loadTarget(companyId, id) {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(selectFields)
    .eq("id", id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function list(req, res) {
  try {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(selectFields)
      .eq("company_id", req.user.company_id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return res.json({ accounts: data || [], assignableRoles: MANAGEABLE[req.user.role] ?? [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function create(req, res) {
  try {
    const { name, email, role, password } = req.body ?? {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: "name is required" });
    if (!email || !/^\S+@\S+\.\S+$/.test(String(email).trim())) {
      return res.status(400).json({ error: "A valid email is required" });
    }
    if (!ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });
    if (!canManage(req.user.role, role)) {
      return res.status(403).json({ error: `You can't create ${role} accounts` });
    }
    if (password != null && String(password).length < 10) {
      return res.status(400).json({ error: "Password must be at least 10 characters" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const { data: existing, error: existingErr } = await supabaseAdmin
      .from(table)
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();
    if (existingErr) throw existingErr;
    if (existing) return res.status(409).json({ error: "Email already registered" });

    const temporaryPassword = password ? String(password) : generateTemporaryPassword();
    const { data, error } = await supabaseAdmin
      .from(table)
      .insert({
        company_id: req.user.company_id,
        name: String(name).trim(),
        email: normalizedEmail,
        role,
        status: "active",
        must_change_password: true,
        password: await bcrypt.hash(temporaryPassword, 10),
      })
      .select(selectFields)
      .single();
    if (error) {
      if (error.code === "23505") return res.status(409).json({ error: "Email already registered" });
      throw error;
    }

    // The password is returned exactly once (and is redacted from the audit log).
    return res.status(201).json({ ...data, temporary_password: temporaryPassword });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function update(req, res) {
  try {
    const companyId = req.user.company_id;
    const target = await loadTarget(companyId, req.params.id);
    if (!target) return res.status(404).json({ error: "Not found" });

    const { name, role } = req.body ?? {};
    if (name === undefined && role === undefined) return res.status(400).json({ error: "No fields to update" });

    if (!canManage(req.user.role, target.role)) {
      return res.status(403).json({ error: "You can't change this account" });
    }
    const payload = {};
    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ error: "name can't be empty" });
      payload.name = String(name).trim();
    }
    if (role !== undefined && role !== target.role) {
      if (!ROLES.includes(role)) return res.status(400).json({ error: "Invalid role" });
      if (String(target.id) === String(req.user.id)) {
        return res.status(400).json({ error: "You can't change your own role" });
      }
      if (!canManage(req.user.role, role)) return res.status(403).json({ error: `You can't assign the ${role} role` });
      if (target.role === "owner" && target.status === "active" && (await activeOwnerCount(companyId, target.id)) === 0) {
        return res.status(400).json({ error: "The company needs at least one active owner" });
      }
      payload.role = role;
    }
    if (Object.keys(payload).length === 0) return res.json(target);

    const { data, error } = await supabaseAdmin
      .from(table)
      .update(payload)
      .eq("id", target.id)
      .eq("company_id", companyId)
      .select(selectFields)
      .single();
    if (error) throw error;
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateStatus(req, res) {
  try {
    const companyId = req.user.company_id;
    const { status } = req.body ?? {};
    if (!statuses.includes(status)) return res.status(400).json({ error: "Invalid status" });

    const target = await loadTarget(companyId, req.params.id);
    if (!target) return res.status(404).json({ error: "Not found" });
    if (String(target.id) === String(req.user.id)) {
      return res.status(400).json({ error: "You can't change your own status" });
    }
    if (!canManage(req.user.role, target.role)) {
      return res.status(403).json({ error: "You can't change this account" });
    }
    if (status !== "active" && target.role === "owner" && (await activeOwnerCount(companyId, target.id)) === 0) {
      return res.status(400).json({ error: "The company needs at least one active owner" });
    }

    const { data, error } = await supabaseAdmin
      .from(table)
      .update({ status })
      .eq("id", target.id)
      .eq("company_id", companyId)
      .select(selectFields)
      .single();
    if (error) throw error;
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function resetPassword(req, res) {
  try {
    const companyId = req.user.company_id;
    const target = await loadTarget(companyId, req.params.id);
    if (!target) return res.status(404).json({ error: "Not found" });
    if (String(target.id) === String(req.user.id)) {
      return res.status(400).json({ error: "Use 'Change password' for your own account" });
    }
    if (!canManage(req.user.role, target.role)) {
      return res.status(403).json({ error: "You can't change this account" });
    }

    const temporaryPassword = generateTemporaryPassword();
    const { error } = await supabaseAdmin
      .from(table)
      .update({ password: await bcrypt.hash(temporaryPassword, 10), must_change_password: true })
      .eq("id", target.id)
      .eq("company_id", companyId);
    if (error) throw error;

    return res.json({ id: target.id, temporary_password: temporaryPassword });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
