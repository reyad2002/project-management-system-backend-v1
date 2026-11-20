import { Router } from "express";
import * as controller from "../controllers/searchController.js";

const router = Router();
router.get("/", controller.search);
export default router;
