import fetch from "node-fetch";
import { logger } from "../utils/logger.js";

const DEFAULT_PHONE_ID = "847112945162261";

function getPhoneId() {
  return process.env.FB_PHONE_ID || process.env.FB_PHONE_NUMBER_ID || DEFAULT_PHONE_ID;
}

function getToken() {
  return process.env.FB_TOKEN || process.env.FB_AUTH_TOKEN || process.env.FB_BEARER_TOKEN || "";
}

function isSendEnabled() {
  return true;
}

function endpoint(phoneId) {
  if (!phoneId) return null;
  return `https://graph.facebook.com/v22.0/${phoneId}/messages`;
}

function sanitizeTitle(value, maxLen) {
  const raw = value == null ? "" : String(value);
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

export async function sendWhatsAppMessage(to, event) {
  const enabled = isSendEnabled();
  const phoneId = getPhoneId();
  const token = getToken();
  const eventType = event?.type || (event?.buttons && event.buttons.length ? "interactive" : "text");
  const buttonsCount = event?.buttons ? event.buttons.length : 0;
  logger.info({
    msg: "FB_SEND_ATTEMPT",
    enabled,
    sendEnabledRaw: process.env.FB_SEND_ENABLED,
    phoneId: phoneId ? "set" : "missing",
    token: token ? "set" : "missing",
    to,
    type: eventType,
    buttons: buttonsCount,
  });
  if (!enabled) {
    logger.info({ msg: "FB_SEND_SKIPPED", reason: "disabled" });
    return { ok: false, reason: "fb_send_disabled" };
  }
  const url = endpoint(phoneId);
  if (!url) {
    logger.warn({ msg: "FB_NO_PHONE_ID" });
    return { ok: false, reason: "no_phone_id" };
  }
  if (!token) {
    logger.warn({ msg: "FB_NO_TOKEN" });
    return { ok: false, reason: "no_token" };
  }

  const body = { messaging_product: "whatsapp", to: String(to), recipient_type: "individual" };

  // Map event to Graph API payload
  if (event.type === "text" || !event.type) {
    body.type = "text";
    body.text = { preview_url: false, body: event.text || String(event) };
  } else if (event.type === "interactive" || (event.buttons && event.buttons.length)) {
    const allButtons = event.buttons || [];
    const buttonTitles = allButtons.map((b) => sanitizeTitle(b.label ?? b.title ?? b, 20));
    const hasLongTitle = buttonTitles.some((t) => t.length > 20 || t.length === 0);
    if (allButtons.length <= 3 && !hasLongTitle) {
      body.type = "interactive";
      const buttons = allButtons.map((b, idx) => ({
        type: "reply",
        reply: { id: String(b.value ?? b.id ?? idx), title: sanitizeTitle(b.label ?? b.title ?? b, 20) || `Opcion ${idx + 1}` }
      }));
      body.interactive = { type: "button", body: { text: event.text || "" }, action: { buttons } };
    } else {
      body.type = "interactive";
      const rows = allButtons.map((b, idx) => ({
        id: String(b.value ?? b.id ?? idx),
        title: sanitizeTitle(b.label ?? b.title ?? b, 24) || `Opcion ${idx + 1}`
      }));
      const sections = [];
      for (let i = 0; i < rows.length; i += 10) {
        sections.push({
          title: `Opciones ${i + 1}-${Math.min(i + 10, rows.length)}`,
          rows: rows.slice(i, i + 10)
        });
      }
      body.interactive = {
        type: "list",
        body: { text: event.text || "" },
        action: {
          button: "Ver opciones",
          sections
        }
      };
    }
  } else if (event.type === "image" && event.url) {
    body.type = "image";
    body.image = { link: event.url };
  } else if (event.type === "document" && event.url) {
    body.type = "document";
    body.document = { link: event.url, filename: event.filename || undefined };
  } else {
    // fallback to text
    body.type = "text";
    body.text = { preview_url: false, body: event.text || JSON.stringify(event) };
  }

  try {
    const payloadInfo = {
      type: body.type,
      buttons: body.type === "interactive"
        ? ((body.interactive?.action?.buttons || body.interactive?.action?.sections?.[0]?.rows || []).length)
        : 0
    };
    logger.info({ msg: "FB_SEND_HTTP", to, url, payload: payloadInfo });
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      logger.error({ msg: "FB_SEND_FAILED", status: resp.status, text: txt, to });
      return { ok: false, status: resp.status, text: txt };
    }
    const data = await resp.json().catch(() => ({}));
    logger.info({ msg: "FB_SEND_OK", to, status: resp.status });
    return { ok: true, data };
  } catch (err) {
    logger.error({ msg: "FB_SEND_ERROR", err: err?.message, to });
    return { ok: false, error: err?.message };
  }
}

export default { sendWhatsAppMessage };
