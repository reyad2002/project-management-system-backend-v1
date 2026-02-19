import { Router } from "express";
import * as authController from "../controllers/authController.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/login", authController.login);
router.post("/login-as-owner", authController.loginAsOwner);
router.get("/me", requireAuth, authController.getMe);
router.post("/logout", authController.logout);
export default router;
