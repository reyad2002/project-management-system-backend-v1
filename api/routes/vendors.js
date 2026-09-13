import { Router } from "express";
import * as vendorsController from "../controllers/vendorsController.js";

const router = Router();

router.get("/", vendorsController.list);
router.get("/shortList", vendorsController.shortList);
router.get("/:id", vendorsController.getOne);
router.post("/", vendorsController.create);
router.put("/:id", vendorsController.update);
router.delete("/:id", vendorsController.remove);

export default router;
