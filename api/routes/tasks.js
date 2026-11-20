import { Router } from "express";
import * as tasksController from "../controllers/tasksController.js";
import * as checklistController from "../controllers/taskChecklistController.js";
import * as dependenciesController from "../controllers/taskDependenciesController.js";
import * as reportsController from "../controllers/taskReportsController.js";
import { requireRole, ACCESS } from "../middleware/auth.js";

const router = Router();

router.get("/", tasksController.listAll);
router.post("/", tasksController.createGeneral);
router.post("/bulk-update", tasksController.bulkUpdate);
router.post("/bulk-delete", tasksController.bulkDelete);
router.get("/summary", tasksController.summary);
router.get("/reports", requireRole(...ACCESS.taskAdmin), reportsController.report);
router.get("/preferences", tasksController.getPreferences);
router.put("/preferences", tasksController.setPreferences);
router.get("/:id", tasksController.getOne);
router.get("/:id/subtasks", tasksController.getSubtasks);
router.put("/:id", tasksController.update);
router.delete("/:id", tasksController.remove);
router.post("/:id/status", tasksController.updateStatus);

router.get("/:taskId/checklist", checklistController.listByTask);
router.post("/:taskId/checklist", checklistController.create);

router.get("/:taskId/dependencies", dependenciesController.list);
router.post("/:taskId/dependencies", dependenciesController.create);
router.delete("/:taskId/dependencies/:dependsOnId", dependenciesController.remove);

export default router;
