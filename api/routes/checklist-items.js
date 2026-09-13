import { Router } from "express";
import * as checklistController from "../controllers/taskChecklistController.js";

const router = Router();

router.put("/:id", checklistController.update);
router.delete("/:id", checklistController.remove);

export default router;
