import { Router } from "express";
import * as accountsController from "../controllers/accountsController.js";

// Mounted behind requireAuth + requireRole("owner", "admin") — see api/index.js.
const router = Router();

router.get("/", accountsController.list);
router.post("/", accountsController.create);
router.put("/:id", accountsController.update);
router.patch("/:id/status", accountsController.updateStatus);
router.post("/:id/reset-password", accountsController.resetPassword);

export default router;
