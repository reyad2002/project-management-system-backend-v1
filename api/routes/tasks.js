import { Router } from "express";
import * as tasksController from "../controllers/tasksController.js";
import * as checklistController from "../controllers/taskChecklistController.js";
import * as dependenciesController from "../controllers/taskDependenciesController.js";

const router = Router();

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
