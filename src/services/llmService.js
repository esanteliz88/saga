const defaultModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
const apiKey = process.env.OPENAI_API_KEY;
import { logger } from "../utils/logger.js";

export async function generateLLMAnswer({ prompt, systemPrompt }) {
  if (!apiKey) {
    logger.warn({ msg: "LLM skipped: missing OPENAI_API_KEY" });
    return { ok: false, text: "No hay clave de IA configurada.", reason: "missing_api_key" };
  }
  try {
    const body = {
      model: defaultModel,
      messages: [
        { role: "system", content: systemPrompt || "Eres un asistente de salud que responde con tono empatico y claro. No des diagnosticos, solo orientacion." },
        { role: "user", content: prompt }
      ],
      max_tokens: 200,
      temperature: 0.4,
    };

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      logger.error({ msg: "LLM HTTP error", status: resp.status, statusText: resp.statusText });
      return { ok: false, text: "La IA no esta disponible ahora.", reason: `http_${resp.status}` };
    }
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      logger.error({ msg: "LLM empty response", data });
      return { ok: false, text: "No obtuve respuesta de la IA.", reason: "empty" };
    }
    logger.info({ msg: "LLM ok", model: data?.model || defaultModel, usage: data?.usage, textPreview: text.slice(0, 120) });
    return { ok: true, text };
  } catch (err) {
    logger.error({ msg: "LLM exception", err: err?.message });
    return { ok: false, text: "Error llamando a la IA.", reason: err.message || "exception" };
  }
}
