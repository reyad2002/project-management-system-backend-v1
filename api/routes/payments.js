import { Router } from "express";
import * as paymentsController from "../controllers/paymentsController.js";

const router = Router();

router.get("/", paymentsController.list);
router.get("/:id", paymentsController.getOne);
router.post("/", paymentsController.create);
router.put("/:id", paymentsController.update);
router.delete("/:id", paymentsController.remove);

export default router;
