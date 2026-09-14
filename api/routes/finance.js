import { Router } from "express";
import * as financeController from "../controllers/financeController.js";

const router = Router();

router.get("/hosting-summary", financeController.hostingSummary);

export default router;
