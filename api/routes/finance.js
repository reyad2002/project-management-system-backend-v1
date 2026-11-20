import { Router } from "express";
import * as financeController from "../controllers/financeController.js";
import * as insights from "../controllers/financeInsightsController.js";

const router = Router();

router.get("/hosting-summary", financeController.hostingSummary);
router.get("/cashflow", insights.cashflow);

export default router;
