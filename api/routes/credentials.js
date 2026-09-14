import { Router } from "express";
import * as credentialsController from "../controllers/credentialsController.js";
import { revealRateLimit } from "../middleware/revealRateLimit.js";

const router = Router();

router.post("/:id/reveal", revealRateLimit, credentialsController.reveal);
router.get("/:id/access-log", credentialsController.accessLog);

export default router;
