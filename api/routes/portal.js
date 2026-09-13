import { Router } from "express";
import * as portalDataController from "../controllers/portalDataController.js";

const router = Router();

router.get("/projects", portalDataController.listProjects);
router.get("/projects/:id", portalDataController.getProject);
router.get("/invoices", portalDataController.listInvoices);
router.get("/invoices/:id", portalDataController.getInvoice);
router.get("/payment-summary", portalDataController.paymentSummary);
router.post("/phases/:id/approve", portalDataController.approvePhase);

export default router;
