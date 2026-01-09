import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { loadEnv } from "./config/env.js";
import { connectDb } from "./config/db.js";
import { botRouter } from "./routes/botRoutes.js";
import { logger } from "./utils/logger.js";
import http from "http";

loadEnv();
await connectDb();

const app = express();
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(morgan("combined"));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "patient-form-bot", ts: new Date().toISOString() });
});

app.use("/bot", botRouter);

// Create HTTP server
const server = http.createServer(app);

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "internal_error" });
});

const port = process.env.PORT || 8080;
server.listen(port, () => logger.info({ port }, "Server + WS started"));
