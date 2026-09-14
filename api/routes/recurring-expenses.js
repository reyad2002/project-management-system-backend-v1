import { Router } from "express";
import * as controller from "../controllers/recurringExpensesController.js";

const router = Router();

router.get("/upcoming", controller.upcoming);
router.get("/overdue", controller.overdue);
router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:id", controller.getOne);
router.patch("/:id", controller.update);
router.delete("/:id", controller.remove);
router.post("/:id/mark-paid", controller.markPaid);

export default router;
