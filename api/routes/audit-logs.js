import { Router } from "express";
import * as auditLogsController from "../controllers/auditLogsController.js";

// Read-only on purpose: the log can't be edited or deleted through the API (the table rejects it too).
// Mounted behind requireAuth + requireRole("owner", "admin") — see api/index.js.
const router = Router();

router.get("/", auditLogsController.list);
router.get("/:id", auditLogsController.getOne);

export default router;
