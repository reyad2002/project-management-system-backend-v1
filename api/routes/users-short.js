import { Router } from "express";
import { supabaseAdmin } from "../../db_connection.js";

const router = Router();

/**
 * GET /api/users/shortList — company-scoped { id, name } list for assignee dropdowns.
 * Deliberately selects only id + name (the users table also holds email and the password hash).
 * The rest of the old /api/users router stays disabled (see routes/users.js).
 */
router.get("/shortList", async (req, res) => {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) return res.status(401).json({ error: "Not authenticated" });

    const { data, error } = await supabaseAdmin
      .from("users")
      .select("id, name")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    if (error) throw error;

    return res.json({ users: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
