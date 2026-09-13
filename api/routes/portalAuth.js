import { Router } from "express";
import * as portalAuthController from "../controllers/portalAuthController.js";
import { requirePortalAuth } from "../middleware/portalAuth.js";

const router = Router();

// public
router.post("/accept-invite", portalAuthController.acceptInvite);
router.post("/login", portalAuthController.login);

// requires a portal-scoped token
router.get("/me", requirePortalAuth, portalAuthController.getMe);
router.post("/logout", requirePortalAuth, portalAuthController.logout);

export default router;
