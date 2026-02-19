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
import companiesRouter from "./routes/companies.js";
// import usersRouter from "./routes/users.js";
import clientsRouter from "./routes/clients.js";
import projectsRouter from "./routes/projects.js";
import paymentsRouter from "./routes/payments.js";
import expensesRouter from "./routes/expenses.js";
import attachmentsRouter from "./routes/attachments.js";
import statisticsRouter from "./routes/statistics.js";
import { requireAuth } from "./middleware/auth.js";
const app = express();
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
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
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
app.use("/api/auth", authRouter);
app.use("/api/companies",  companiesRouter);
// app.use("/api/users", requireSupabase, usersRouter);
app.use("/api/clients", requireSupabase, requireAuth, clientsRouter);
app.use("/api/projects", requireSupabase, requireAuth, projectsRouter);
app.use("/api/payments", requireSupabase, requireAuth, paymentsRouter);
app.use("/api/expenses", requireSupabase, requireAuth, expensesRouter);
app.use("/api/attachments", requireSupabase, requireAuth, attachmentsRouter);
app.use("/api/statistics", requireSupabase, requireAuth, statisticsRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;