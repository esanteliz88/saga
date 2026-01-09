import fetch from "node-fetch";
import { logger } from "../utils/logger.js";

const PHONE_ID = process.env.FB_PHONE_ID || process.env.FB_PHONE_NUMBER_ID || "";
const TOKEN = process.env.FB_TOKEN || process.env.FB_AUTH_TOKEN || process.env.FB_BEARER_TOKEN || "";
const ENABLE = (process.env.FB_SEND_ENABLED || "false").toLowerCase() === "true";

function endpoint() {
  if (!PHONE_ID) return null;
  return `https://graph.facebook.com/v22.0/${PHONE_ID}/messages`;
}

export async function sendWhatsAppMessage(to, event) {
  if (!ENABLE) return { ok: false, reason: "fb_send_disabled" };
  const url = endpoint();
  if (!url) {
    logger.warn({ msg: "FB_NO_PHONE_ID" });
    return { ok: false, reason: "no_phone_id" };
  }
  if (!TOKEN) {
    logger.warn({ msg: "FB_NO_TOKEN" });
    return { ok: false, reason: "no_token" };
  }

  const body = { messaging_product: "whatsapp", to: String(to), recipient_type: "individual" };

  // Map event to Graph API payload
  if (event.type === "text" || !event.type) {
    body.type = "text";
    body.text = { preview_url: false, body: event.text || String(event) };
  } else if (event.type === "interactive" || (event.buttons && event.buttons.length)) {
    body.type = "interactive";
    const buttons = (event.buttons || []).slice(0, 3).map((b, idx) => ({ type: "reply", reply: { id: String(b.value ?? b.id ?? idx), title: String(b.label ?? b.title ?? b) } }));
    body.interactive = { type: "button", body: { text: event.text || "" }, action: { buttons } };
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
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      logger.error({ msg: "FB_SEND_FAILED", status: resp.status, text: txt, to });
      return { ok: false, status: resp.status, text: txt };
    }
    const data = await resp.json().catch(() => ({}));
    logger.info({ msg: "FB_SEND_OK", to });
    return { ok: true, data };
  } catch (err) {
    logger.error({ msg: "FB_SEND_ERROR", err: err?.message, to });
    return { ok: false, error: err?.message };
  }
}

export default { sendWhatsAppMessage };
