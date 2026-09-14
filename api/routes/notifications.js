import { Router } from "express";
import * as notificationsController from "../controllers/notificationsController.js";

const router = Router();

router.get("/", notificationsController.list);
router.patch("/read-all", notificationsController.markAllRead);
router.patch("/:id/read", notificationsController.markRead);

export default router;
