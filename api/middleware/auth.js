import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../../db_connection.js";

const usersTable = "users";
const userSelectFields = "id, created_at, name, email, status, company_id, company(name)";

export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Authorization token required" });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      return res.status(503).json({ error: "Auth not configured" });
    }

    const payload = jwt.verify(token, secret);
    const userId = payload.sub ?? payload.userId ?? payload.id;
    if (!userId) {
      return res.status(401).json({ error: "Invalid token" });
    }

    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const { data: user, error } = await supabaseAdmin
      .from(usersTable)
      .select(userSelectFields)
      .eq("id", userId)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: "User not found" });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
}
