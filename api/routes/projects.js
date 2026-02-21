import { Router } from "express";
import * as projectsController from "../controllers/projectsController.js";
import * as paymentsController from "../controllers/paymentsController.js";
import * as expensesController from "../controllers/expensesController.js";
import * as attachmentsController from "../controllers/attachmentsController.js";
import * as phasesController from "../controllers/phasesController.js";

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

export default router;
