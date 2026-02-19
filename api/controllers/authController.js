import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../../db_connection.js";
import dotenv from "dotenv";
dotenv.config();
const usersTable = "users";
const userSelectFields =
  "id, created_at, name, email, status, company_id, company(name)";

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
        `id, created_at, name, email, status, company_id, password, company(name)`,
      )
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (error) throw error;
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (user.status === "blocked" || user.status === "inactive") {
      return res.status(403).json({ error: "Account is blocked or inactive" });
    }

    const { password: _, ...userWithoutPassword } = user;
    const token = jwt.sign(
      { sub: user.id, company_id: user.company_id },
      secret,
      { expiresIn: process.env.JWT_EXPIRES_IN ?? "1d" },
    );

    res.json({ user: userWithoutPassword, token });
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

export async function logout(req, res) {
  try {
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
