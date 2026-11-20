import jwt from "jsonwebtoken";
import { supabaseAdmin } from "../../db_connection.js";

const usersTable = "users";
const userSelectFields =
  "id, created_at, name, email, status, role, must_change_password, last_login_at, company_id, company(name)";

/** Roles, from most to least powerful. */
export const ROLES = ["owner", "admin", "manager", "accountant", "member"];

/** Who may use which area. Keep in sync with the frontend's lib/permissions.ts. */
export const ACCESS = {
  accounts: ["owner", "admin"], // create/disable accounts, audit log
  finance: ["owner", "admin", "manager", "accountant"], // invoices, payments, expenses, reports...
  credentials: ["owner", "admin", "manager", "member"], // project credentials (not for accountants)
};

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

    if (payload.scope === "portal") {
      return res.status(403).json({ error: "Invalid token scope for this endpoint" });
    }

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

    // A blocked/disabled account loses access immediately, not when its token expires.
    if (user.status === "blocked" || user.status === "inactive") {
      return res.status(403).json({ error: "Account is blocked or inactive" });
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

/** Use after requireAuth: `router.get("/", requireRole(...ACCESS.finance), handler)`. */
export function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({ error: "You don't have permission to do this" });
    }
    next();
  };
}
