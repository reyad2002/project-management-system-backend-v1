import { Router } from "express";
import * as projectLinksController from "../controllers/projectLinksController.js";

const router = Router();

router.delete("/:id", projectLinksController.remove);

export default router;
