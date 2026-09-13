import { Router } from "express";
import * as clientsController from "../controllers/clientsController.js";
import * as clientPortalUsersController from "../controllers/clientPortalUsersController.js";

const router = Router();

router.get("/", clientsController.list);
router.get("/shortList", clientsController.shortList);
router.get("/:id/payment-summary", clientsController.getPaymentSummary);
router.get("/:clientId/portal-users", clientPortalUsersController.list);
router.post("/:clientId/portal-users", clientPortalUsersController.create);
router.delete("/:clientId/portal-users/:id", clientPortalUsersController.remove);
router.get("/:id", clientsController.getOne);
router.post("/", clientsController.create);
router.put("/:id", clientsController.update);
router.delete("/:id", clientsController.remove);

export default router;
