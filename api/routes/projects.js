import { Router } from "express";
import * as projectsController from "../controllers/projectsController.js";
import * as paymentsController from "../controllers/paymentsController.js";
import * as expensesController from "../controllers/expensesController.js";
import * as attachmentsController from "../controllers/attachmentsController.js";
import * as phasesController from "../controllers/phasesController.js";
import * as projectMembersController from "../controllers/projectMembersController.js";
import * as tasksController from "../controllers/tasksController.js";
import * as timelineController from "../controllers/timelineController.js";
import * as meetingsController from "../controllers/meetingsController.js";
import * as projectLinksController from "../controllers/projectLinksController.js";
import * as credentialsController from "../controllers/credentialsController.js";
import * as feedbackController from "../controllers/feedbackController.js";

const router = Router();

router.get("/", projectsController.list);
router.get("/shortList", projectsController.shortList);
router.get("/:id", projectsController.getOne);
router.post("/", projectsController.create);
router.put("/:id", projectsController.update);
router.delete("/:id", projectsController.remove);
router.get("/:id/payments", paymentsController.listByProject);

// All phase operations by project id
router.get("/:id/phases", phasesController.listByProject);
router.post("/:id/phases", phasesController.createByProject);
router.get("/:id/phases/:phaseId", phasesController.getOneByProject);
router.put("/:id/phases/:phaseId", phasesController.updateByProject);
router.delete("/:id/phases/:phaseId", phasesController.removeByProject);

// Project team members
router.get("/:projectId/members", projectMembersController.list);
router.post("/:projectId/members", projectMembersController.create);
router.put("/:projectId/members/:memberId", projectMembersController.update);
router.delete("/:projectId/members/:memberId", projectMembersController.remove);

// Tasks scoped by project id
router.get("/:id/tasks", tasksController.listByProject);
router.post("/:id/tasks", tasksController.createByProject);
router.post("/:id/tasks/reorder", tasksController.reorder);

// Timeline / Gantt
router.get("/:id/timeline", timelineController.getProjectTimeline);

// Meetings scoped by project id
router.post("/:id/meetings", meetingsController.createByProject);
router.get("/:id/meetings", meetingsController.listByProject);

// Project links scoped by project id
router.post("/:id/links", projectLinksController.createByProject);
router.get("/:id/links", projectLinksController.listByProject);

// Credentials scoped by project id
router.post("/:id/credentials", credentialsController.create);
router.get("/:id/credentials", credentialsController.listByProject);

// Feedback scoped by project id
router.get("/:id/feedback", feedbackController.listByProject);

export default router;
