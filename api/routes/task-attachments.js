import { Router } from "express";
import * as controller from "../controllers/taskAttachmentsController.js";

const router = Router();

router.get("/", controller.list);
router.post("/", controller.create);
router.delete("/:id", controller.remove);

export default router;
