import { Router } from "express";
import * as invoicesController from "../controllers/invoicesController.js";

const router = Router();

router.get("/", invoicesController.list);
router.get("/:id", invoicesController.getOne);
router.post("/", invoicesController.create);
router.put("/:id", invoicesController.update);
router.post("/:id/send", invoicesController.send);
router.post("/:id/cancel", invoicesController.cancel);

export default router;
