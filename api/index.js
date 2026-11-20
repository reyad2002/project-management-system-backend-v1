import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import mongoose from "mongoose";
import swaggerUi from "swagger-ui-express";
import swaggerJsdoc from "swagger-jsdoc";
import multer from "multer";
import dayjs from "dayjs";
import bcrypt from "bcryptjs";
import jsonwebtoken from "jsonwebtoken";
import nodemailer from "nodemailer";
import xlsx from "xlsx";
import { verifySupabaseConnection, supabaseAdmin } from "../db_connection.js";
import authRouter from "./routes/auth.js";
// import usersRouter from "./routes/users.js";
import usersShortRouter from "./routes/users-short.js";
import accountsRouter from "./routes/accounts.js";
import auditLogsRouter from "./routes/audit-logs.js";
import clientsRouter from "./routes/clients.js";
import projectsRouter from "./routes/projects.js";
import paymentsRouter from "./routes/payments.js";
import expensesRouter from "./routes/expenses.js";
import attachmentsRouter from "./routes/attachments.js";
import statisticsRouter from "./routes/statistics.js";
import invoicesRouter from "./routes/invoices.js";
import vendorsRouter from "./routes/vendors.js";
import vendorBillsRouter from "./routes/vendor-bills.js";
import teamRouter from "./routes/team.js";
import tasksRouter from "./routes/tasks.js";
import checklistItemsRouter from "./routes/checklist-items.js";
import portalAuthRouter from "./routes/portalAuth.js";
import portalRouter from "./routes/portal.js";
import notificationsRouter from "./routes/notifications.js";
import meetingsRouter from "./routes/meetings.js";
import projectLinksRouter from "./routes/project-links.js";
import credentialsRouter from "./routes/credentials.js";
import filesRouter from "./routes/files.js";
import recurringRevenueRouter from "./routes/recurring-revenue.js";
import recurringExpensesRouter from "./routes/recurring-expenses.js";
import projectReportsRouter from "./routes/project-reports.js";
import investmentsRouter from "./routes/investments.js";
import financeRouter from "./routes/finance.js";
import internalRouter from "./routes/internal.js";
import { requireAuth, requireRole, ACCESS } from "./middleware/auth.js";
import { auditMutations } from "./lib/audit.js";
import { requirePortalAuth } from "./middleware/portalAuth.js";
const app = express();
// Behind Vercel's proxy: lets req.ip / the audit log see the caller's address.
app.set("trust proxy", true);
dotenv.config();

const PORT = process.env.PORT || 3001;

const requireSupabase = (req, res, next) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: "Database not configured" });
  }
  next();
};

const whitelist = ["http://localhost:3000" , "https://project-management-system-frontend-seven.vercel.app"];
const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || whitelist.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(
  morgan(":method :status - :response-time ms :url :res[content-length] "),
);

app.get("/health", async (_req, res) => {
  const result = await verifySupabaseConnection();
  res.status(result.ok ? 200 : 503).json(result);
});
// Every protected router: database available -> authenticated -> (role) -> audited.
const secured = (...roles) => [
  requireSupabase,
  requireAuth,
  ...(roles.length ? [requireRole(...roles)] : []),
  auditMutations,
];

app.use("/api/auth", authRouter);

// SECURITY: the former /api/companies router was mounted WITHOUT authentication (anyone could list
// companies, create users and reset any user's password) and is intentionally no longer mounted.
// Accounts are managed per company through /api/accounts (owner / admin only).
app.use("/api/accounts", ...secured(...ACCESS.accounts), accountsRouter);
app.use("/api/audit-logs", ...secured(...ACCESS.accounts), auditLogsRouter);

app.use("/api/users", ...secured(), usersShortRouter);
app.use("/api/clients", ...secured(), clientsRouter);
app.use("/api/projects", ...secured(), projectsRouter);
app.use("/api/attachments", ...secured(), attachmentsRouter);
app.use("/api/team", ...secured(), teamRouter);
app.use("/api/tasks", ...secured(), tasksRouter);
app.use("/api/checklist-items", ...secured(), checklistItemsRouter);
app.use("/api/notifications", ...secured(), notificationsRouter);
app.use("/api/meetings", ...secured(), meetingsRouter);
app.use("/api/project-links", ...secured(), projectLinksRouter);
app.use("/api/files", ...secured(), filesRouter);
app.use("/api/project-reports", ...secured(), projectReportsRouter);

// Money: owner / admin / manager / accountant
app.use("/api/payments", ...secured(...ACCESS.finance), paymentsRouter);
app.use("/api/expenses", ...secured(...ACCESS.finance), expensesRouter);
app.use("/api/statistics", ...secured(...ACCESS.finance), statisticsRouter);
app.use("/api/invoices", ...secured(...ACCESS.finance), invoicesRouter);
app.use("/api/vendors", ...secured(...ACCESS.finance), vendorsRouter);
app.use("/api/vendor-bills", ...secured(...ACCESS.finance), vendorBillsRouter);
app.use("/api/recurring-revenue", ...secured(...ACCESS.finance), recurringRevenueRouter);
app.use("/api/recurring-expenses", ...secured(...ACCESS.finance), recurringExpensesRouter);
app.use("/api/investments", ...secured(...ACCESS.finance), investmentsRouter);
app.use("/api/finance", ...secured(...ACCESS.finance), financeRouter);

// Project credentials: not for accountants
app.use("/api/credentials", ...secured(...ACCESS.credentials), credentialsRouter);

app.use("/api/portal/auth", requireSupabase, portalAuthRouter);
app.use("/api/portal", requireSupabase, requirePortalAuth, auditMutations, portalRouter);
app.use("/api/internal", requireSupabase, internalRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;