import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { loadEnv } from "./config/env.js";
import { connectDb } from "./config/db.js";
import { botRouter } from "./routes/botRoutes.js";
import { logger } from "./utils/logger.js";
import http from "http";
import { WebSocketServer } from "ws";
import { handleBotMessage } from "./controllers/botController.js";
import { registerConnection, unregisterConnection, sendTo, unregisterByWs } from "./services/wsRegistry.js";

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

// Create HTTP server and attach WebSocket server to allow WS-based testing
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: "/ws" });

function buildFakeResForSocket(ws) {
  return {
    json: (obj) => {
      try {
        ws.send(JSON.stringify({ type: "reply", payload: obj }));
      } catch (e) {
        // ignore send errors
      }
    },
    status: (code) => ({ json: (obj) => { try { ws.send(JSON.stringify({ type: "reply", status: code, payload: obj })); } catch (e) {} } }),
    send: (v) => { try { ws.send(typeof v === "string" ? v : JSON.stringify(v)); } catch (e) {} }
  };
}

// Expect incoming messages as JSON similar to your WS sample. We normalize and call handleBotMessage
wss.on("connection", (ws) => {
  ws.on("message", async (data) => {
    let body = null;
    try {
      body = typeof data === "string" ? JSON.parse(data) : JSON.parse(data.toString());
    } catch (e) {
      return ws.send(JSON.stringify({ error: "invalid_json" }));
    }

    // If client registers its wa_id, store connection
    if (body && body.type === "register" && body.wa_id) {
      registerConnection(body.wa_id, ws);
      try { ws.send(JSON.stringify({ type: "registered", wa_id: body.wa_id })); } catch (e) {}
      return;
    }

    // If client asks to unregister
    if (body && body.type === "unregister" && body.wa_id) {
      unregisterConnection(body.wa_id);
      try { ws.send(JSON.stringify({ type: "unregistered", wa_id: body.wa_id })); } catch (e) {}
      return;
    }

    // Normalize WS payload (accept direct message shape or webhook shape)
    const normalized = (body && body.from) ? {
      channel: body.channel || "whatsapp",
      user: { wa_id: body.from, name: body.name },
      message: { id: body.id, text: (body.text && (body.text.body || body.text)) || "", type: body.type || "text", attachments: body.attachments || [] },
      formCode: body.formCode
    } : (body && body.entry) ? (function() {
      const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0] || {};
      const text = (msg.text && msg.text.body) || (msg.interactive && ((msg.interactive.button_reply && msg.interactive.button_reply.title) || (msg.interactive.list_reply && msg.interactive.list_reply.title))) || "";
      const atts = [];
      if (msg.image && (msg.image.link || msg.image.url)) atts.push({ url: msg.image.link || msg.image.url });
      if (msg.document && (msg.document.link || msg.document.url)) atts.push({ url: msg.document.link || msg.document.url });
      if (msg.video && (msg.video.link || msg.video.url)) atts.push({ url: msg.video.link || msg.video.url });
      return { channel: "whatsapp", user: { wa_id: msg.from || msg.from_number || msg.sender || "" }, message: { id: msg.id || msg.message_id, text, type: msg.type || "text", attachments: atts }, formCode: undefined };
    })() : body;

    const fakeReq = { body: normalized };
    const fakeRes = buildFakeResForSocket(ws);
    try {
      // If handleBotMessage returns a reply via fakeRes.json it will be sent to the same ws by buildFakeResForSocket
      await handleBotMessage(fakeReq, fakeRes);
    } catch (e) {
      try { ws.send(JSON.stringify({ error: "internal_error" })); } catch (err) {}
    }
  });

  ws.on("close", () => {
    try { unregisterByWs(ws); } catch (e) {}
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error({ err }, "Unhandled error");
  res.status(500).json({ error: "internal_error" });
});

const port = process.env.PORT || 8080;
server.listen(port, () => logger.info({ port }, "Server + WS started"));
