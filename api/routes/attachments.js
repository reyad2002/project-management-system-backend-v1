import { Router } from "express";
import * as attachmentsController from "../controllers/attachmentsController.js";

const router = Router();

router.get("/", attachmentsController.list);
router.get("/:id", attachmentsController.getOne);
router.post("/", attachmentsController.create);
router.put("/:id", attachmentsController.update);
router.delete("/:id", attachmentsController.remove);

export default router;
