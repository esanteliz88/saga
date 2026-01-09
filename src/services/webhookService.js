import { logger } from "../utils/logger.js";

const endpoint = process.env.FINALIZE_ENDPOINT || "https://n8n.guiaysalud.com/webhook/data-filter";
const apiKey = process.env.FINALIZE_API_KEY || process.env.API_KEY || "";

export async function sendFinalizePayload(payload) {
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "x-api-key": apiKey } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const text = await resp.text();
      logger.error({ msg: "FINALIZE_WEBHOOK_FAILED", status: resp.status, text });
      return { ok: false, status: resp.status, text };
    }
    const data = await resp.json().catch(() => ({}));
    logger.info({ msg: "FINALIZE_WEBHOOK_OK", status: resp.status });
    return { ok: true, data };
  } catch (err) {
    logger.error({ msg: "FINALIZE_WEBHOOK_ERROR", err: err?.message });
    return { ok: false, error: err?.message };
  }
}
