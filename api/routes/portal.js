import { Router } from "express";
import * as portalDataController from "../controllers/portalDataController.js";
import * as notificationsController from "../controllers/notificationsController.js";
import * as portalMeetingsController from "../controllers/portalMeetingsController.js";
import * as projectLinksController from "../controllers/projectLinksController.js";
import * as tasksController from "../controllers/tasksController.js";
import * as credentialsController from "../controllers/credentialsController.js";
import * as feedbackController from "../controllers/feedbackController.js";
import * as projectFilesController from "../controllers/projectFilesController.js";
import { revealRateLimit } from "../middleware/revealRateLimit.js";

const router = Router();

router.get("/projects", portalDataController.listProjects);
router.get("/projects/:id", portalDataController.getProject);
router.get("/invoices", portalDataController.listInvoices);
router.get("/invoices/:id", portalDataController.getInvoice);
router.get("/payment-summary", portalDataController.paymentSummary);
router.post("/phases/:id/approve", portalDataController.approvePhase);

// Notifications
router.get("/notifications", notificationsController.listPortal);
router.patch("/notifications/read-all", notificationsController.markAllReadPortal);
router.patch("/notifications/:id/read", notificationsController.markReadPortal);

// Meetings + notes (read-only)
router.get("/projects/:id/meetings", portalMeetingsController.listByProject);
router.get("/meetings/:id/notes", portalMeetingsController.listNotes);
router.post("/meeting-notes/:id/mark-read", portalMeetingsController.markNoteRead);
router.get("/meeting-notes/:id/export", portalMeetingsController.exportNote);

// Project links (read-only)
router.get("/projects/:id/links", projectLinksController.portalListByProject);

// Pending on client (read-only)
router.get("/projects/:id/tasks", tasksController.portalListPendingByProject);

// Credentials
router.get("/projects/:id/credentials", credentialsController.portalListByProject);
router.post("/credentials/:id/reveal", revealRateLimit, credentialsController.portalReveal);

// Micro-feedback
router.post("/feedback", feedbackController.portalSubmit);

// Files
router.post("/projects/:id/files", projectFilesController.portalCreateByProject);
router.get("/projects/:id/files", projectFilesController.portalListByProject);
router.patch("/files/:fileId/status", projectFilesController.portalUpdateStatus);
router.get("/files/:fileId/comments", projectFilesController.portalListComments);
router.post("/files/:fileId/comments", projectFilesController.portalCreateComment);

export default router;
