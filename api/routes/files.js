import { Router } from "express";
import * as projectFilesController from "../controllers/projectFilesController.js";

const router = Router();

router.get("/:fileId/comments", projectFilesController.listComments);
router.post("/:fileId/comments", projectFilesController.createComment);

export default router;
