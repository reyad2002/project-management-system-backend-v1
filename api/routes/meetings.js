import { Router } from "express";
import * as meetingsController from "../controllers/meetingsController.js";

const router = Router();

router.patch("/:id", meetingsController.update);

router.post("/:id/notes", meetingsController.createNote);
router.get("/:id/notes", meetingsController.listNotes);
router.get("/:id/notes/export", meetingsController.exportNotes);

export default router;
