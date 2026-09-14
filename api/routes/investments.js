import { Router } from "express";
import * as controller from "../controllers/investmentsController.js";

const router = Router();

router.get("/summary", controller.summary);
router.get("/", controller.list);
router.post("/", controller.create);
router.get("/:id", controller.getOne);
router.patch("/:id", controller.update);
router.delete("/:id", controller.remove);
router.post("/:id/returns", controller.addReturn);
router.get("/:id/returns", controller.listReturns);

export default router;
