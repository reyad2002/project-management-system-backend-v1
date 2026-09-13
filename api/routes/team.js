import { Router } from "express";
import * as teamController from "../controllers/teamController.js";

const router = Router();

router.get("/workload", teamController.getWorkload);

export default router;
