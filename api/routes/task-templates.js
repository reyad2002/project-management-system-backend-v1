import { Router } from "express";
import * as controller from "../controllers/taskTemplatesController.js";

const router = Router();

router.get("/", controller.list);
router.post("/", controller.create);
router.post("/defaults", controller.restoreDefaults);
router.get("/:id", controller.getOne);
router.put("/:id", controller.update);
router.delete("/:id", controller.remove);
router.post("/:id/apply", controller.apply);

export default router;
