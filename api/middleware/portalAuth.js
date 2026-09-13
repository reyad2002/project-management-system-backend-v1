import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../../db_connection.js";

const table = "client_portal_users";
const selectFields = "id, company_id, client_id, name, email, status";

export async function requirePortalAuth(req, res, next) {
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

    if (payload.scope !== "portal") {
      return res.status(403).json({ error: "Invalid token scope for this endpoint" });
    }

    const portalUserId = payload.sub;
    if (!portalUserId) {
      return res.status(401).json({ error: "Invalid token" });
    }

    if (!supabaseAdmin) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const { data: portalUser, error } = await supabaseAdmin
      .from(table)
      .select(selectFields)
      .eq("id", portalUserId)
      .maybeSingle();

    if (error || !portalUser || portalUser.status !== "active") {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    req.portalUser = portalUser;
    next();
  } catch (err) {
    if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    return res.status(500).json({ error: err.message });
  }
}
