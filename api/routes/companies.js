import { Router } from "express";
import * as companiesController from "../controllers/companiesController.js";

const router = Router();

router.get("/", companiesController.list);
router.get("/:id", companiesController.getOne);
router.post("/", companiesController.create);
router.put("/:id", companiesController.update);
router.delete("/:id", companiesController.remove);
router.post("/:id/users", companiesController.createUser);
router.put("/:id/users/:userId", companiesController.updateUser);
router.delete("/:id/users/:userId", companiesController.deleteUser);
router.get("/:id/users", companiesController.listUsers);
router.get("/:id/users/:userId", companiesController.getUser);
router.patch("/:id/users/:userId/status", companiesController.updateUserStatus);
router.patch(
  "/:id/users/:userId/password",
  companiesController.updateUserPassword,
);

export default router;
