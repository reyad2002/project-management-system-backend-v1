import { Router } from "express";
import * as controller from "../controllers/clientHealthController.js";

const router = Router();
router.get("/", controller.listContacts);
router.post("/", controller.createContact);
router.delete("/:id", controller.removeContact);
export default router;
