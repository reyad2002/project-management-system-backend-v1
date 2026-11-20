import { Router } from "express";
import * as statisticsController from "../controllers/statisticsController.js";
import * as monthlyReportController from "../controllers/monthlyReportController.js";

const router = Router();

router.get("/", statisticsController.getDashboard);
router.get("/financial", statisticsController.getFinancial);
router.get("/overview", statisticsController.getOverview);
router.get("/monthly", monthlyReportController.getYear);
router.get("/monthly/:month", monthlyReportController.getMonth);
router.get("/projects", statisticsController.getProjectsStats);
router.get("/payments", statisticsController.getPaymentsStats);
router.get("/expenses", statisticsController.getExpensesStats);
router.get("/ar-aging", statisticsController.getArAging);
router.get("/ap-aging", statisticsController.getApAging);
router.get("/project-profitability", statisticsController.getProjectProfitability);

export default router;
