import { Router } from "express";
import * as projectsController from "../controllers/projectsController.js";
import * as paymentsController from "../controllers/paymentsController.js";
import * as expensesController from "../controllers/expensesController.js";
import * as attachmentsController from "../controllers/attachmentsController.js";

const router = Router();

router.get("/", projectsController.list);
router.get("/shortList", projectsController.shortList);
router.get("/:id", projectsController.getOne);
router.post("/", projectsController.create);
router.put("/:id", projectsController.update);
router.delete("/:id", projectsController.remove);
router.get("/:id/payments", paymentsController.listByProject);
// router.get("/:id/expenses", expensesController.list);
// router.get("/:id/attachments", attachmentsController.list);

export default router;
