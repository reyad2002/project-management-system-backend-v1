import { Router } from "express";
import * as vendorBillsController from "../controllers/vendorBillsController.js";

const router = Router();

router.get("/", vendorBillsController.list);
router.get("/:id", vendorBillsController.getOne);
router.post("/", vendorBillsController.create);
router.put("/:id", vendorBillsController.update);
router.delete("/:id", vendorBillsController.remove);
router.post("/:id/payments", vendorBillsController.addPayment);

export default router;
