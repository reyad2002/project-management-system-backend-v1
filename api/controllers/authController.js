import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../../db_connection.js";
import dotenv from "dotenv";
import { writeAudit } from "../lib/audit.js";
dotenv.config();
const usersTable = "users";
const userSelectFields =
  "id, created_at, name, email, status, role, must_change_password, last_login_at, company_id, company(name)";

export async function login(req, res) {
  try {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res
        .status(503)
        .json({ error: "Auth not configured (JWT_SECRET)" });
    }

    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const { data: user, error } = await supabaseAdmin
      .from(usersTable)
      .select(
        `id, created_at, name, email, status, role, must_change_password, last_login_at, company_id, password, company(name)`,
      )
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) throw error;
    if (!user) {
      await writeAudit(req, {
        actor_type: "anonymous",
        action: "login_failed",
        entity_type: "account",
        outcome: "failure",
        status_code: 401,
        summary: `Failed login for unknown email ${normalizedEmail}`,
        metadata: { email: normalizedEmail },
      });
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = user.password ? await bcrypt.compare(password, user.password) : false;
    if (!valid) {
      await writeAudit(req, {
        company_id: user.company_id,
        actor_type: "anonymous",
        action: "login_failed",
        entity_type: "account",
        entity_id: user.id,
        outcome: "failure",
        status_code: 401,
        summary: `Failed login (wrong password) for ${user.name}`,
        metadata: { email: normalizedEmail },
      });
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (user.status === "blocked" || user.status === "inactive") {
      await writeAudit(req, {
        company_id: user.company_id,
        actor_type: "user",
        actor_id: user.id,
        actor_name: user.name,
        action: "login_blocked",
        entity_type: "account",
        entity_id: user.id,
        outcome: "failure",
        status_code: 403,
        summary: `${user.name} tried to log in but the account is ${user.status}`,
      });
      return res.status(403).json({ error: "Account is blocked or inactive" });
    }

    const { password: _, ...userWithoutPassword } = user;
    const token = jwt.sign(
      { sub: user.id, company_id: user.company_id },
      secret,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? "1d" },
    );

    const now = new Date().toISOString();
    await supabaseAdmin.from(usersTable).update({ last_login_at: now }).eq("id", user.id);
    await writeAudit(req, {
      company_id: user.company_id,
      actor_type: "user",
      actor_id: user.id,
      actor_name: user.name,
      action: "login",
      entity_type: "account",
      entity_id: user.id,
      status_code: 200,
      summary: `${user.name} logged in`,
    });

    res.json({ user: { ...userWithoutPassword, last_login_at: now }, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function loginAsOwner(req, res) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }
    const normalizedEmail = String(email).trim().toLowerCase();
    const ownerEmail = process.env.OWNER_EMAIL;
    const ownerPassword = process.env.OWNER_PASSWORD;
    if (normalizedEmail !== ownerEmail || password !== ownerPassword) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    const token = jwt.sign({ sub: ownerEmail }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN ?? "1d",
    });
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getMe(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "Not authenticated" });
    }
    res.json(req.user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function changePassword(req, res) {
  try {
    const { current_password, new_password } = req.body ?? {};
    if (!current_password || !new_password) {
      return res.status(400).json({ error: "current_password and new_password are required" });
    }
    if (String(new_password).length < 10) {
      return res.status(400).json({ error: "New password must be at least 10 characters" });
    }
    if (String(new_password) === String(current_password)) {
      return res.status(400).json({ error: "New password must be different from the current one" });
    }

    const { data: row, error } = await supabaseAdmin.from(usersTable).select("password").eq("id", req.user.id).single();
    if (error) throw error;

    // 400, not 401: the frontend treats any 401 as "session expired" and logs the user out.
    const valid = row?.password ? await bcrypt.compare(String(current_password), row.password) : false;
    if (!valid) {
      await writeAudit(req, {
        company_id: req.user.company_id,
        actor_type: "user",
        actor_id: req.user.id,
        actor_name: req.user.name,
        action: "password_change_failed",
        entity_type: "account",
        entity_id: req.user.id,
        outcome: "failure",
        status_code: 400,
        summary: `${req.user.name} entered a wrong current password while changing it`,
      });
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    const { error: updateErr } = await supabaseAdmin
      .from(usersTable)
      .update({ password: await bcrypt.hash(String(new_password), 10), must_change_password: false })
      .eq("id", req.user.id);
    if (updateErr) throw updateErr;

    await writeAudit(req, {
      company_id: req.user.company_id,
      actor_type: "user",
      actor_id: req.user.id,
      actor_name: req.user.name,
      action: "password_changed",
      entity_type: "account",
      entity_id: req.user.id,
      status_code: 200,
      summary: `${req.user.name} changed their password`,
    });

    return res.json({ message: "Password changed" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function logout(req, res) {
  try {
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
