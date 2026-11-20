import { Router } from "express";
import * as controller from "../controllers/todayController.js";

const router = Router();
router.get("/", controller.today);
export default router;
