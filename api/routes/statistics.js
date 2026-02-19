import { Router } from "express";
import * as statisticsController from "../controllers/statisticsController.js";

const router = Router();

router.get("/", statisticsController.getDashboard);
router.get("/financial", statisticsController.getFinancial);
router.get("/overview", statisticsController.getOverview);
router.get("/projects", statisticsController.getProjectsStats);
router.get("/payments", statisticsController.getPaymentsStats);
router.get("/expenses", statisticsController.getExpensesStats);

export default router;
