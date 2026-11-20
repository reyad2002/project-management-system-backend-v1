import { Router } from "express";
import * as projectReportsController from "../controllers/projectReportsController.js";

const router = Router();

router.put("/:id", projectReportsController.update);
router.delete("/:id", projectReportsController.remove);

export default router;
