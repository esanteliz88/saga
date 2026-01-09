import { logger } from "../utils/logger.js";

const DEFAULT_MODEL = process.env.OPENAI_AUDIO_MODEL || "whisper-1";

async function fetchWhatsAppMediaUrl(mediaId, token) {
  if (!mediaId || !token) return null;
  const url = `https://graph.facebook.com/v22.0/${mediaId}`;
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      logger.error({ msg: "WA_MEDIA_META_FAILED", status: resp.status });
      return null;
    }
    const data = await resp.json();
    if (!data?.url) return null;
    return { url: data.url, mime: data.mime_type };
  } catch (err) {
    logger.error({ msg: "WA_MEDIA_META_ERROR", err: err?.message });
    return null;
  }
}

async function downloadMedia(url, token) {
  const resp = await fetch(url, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resp.ok) {
    throw new Error(`media_download_${resp.status}`);
  }
  return { buffer: await resp.arrayBuffer(), mime: resp.headers.get("content-type") || undefined };
}

function fileNameFromMime(mime) {
  if (!mime) return "audio.ogg";
  if (mime.includes("mpeg")) return "audio.mp3";
  if (mime.includes("wav")) return "audio.wav";
  if (mime.includes("mp4")) return "audio.mp4";
  if (mime.includes("ogg")) return "audio.ogg";
  return "audio.dat";
}

export async function transcribeAudioAttachment(att) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, reason: "missing_api_key" };
  if (!att) return { ok: false, reason: "no_attachment" };

  const token = process.env.FB_TOKEN || process.env.FB_AUTH_TOKEN || process.env.FB_BEARER_TOKEN || "";
  let mediaUrl = att.url;
  let mime = att.mime;
  if (!mediaUrl && att.id) {
    const meta = await fetchWhatsAppMediaUrl(att.id, token);
    if (!meta) return { ok: false, reason: "media_meta_failed" };
    mediaUrl = meta.url;
    mime = meta.mime || mime;
  }
  if (!mediaUrl) return { ok: false, reason: "no_media_url" };

  try {
    const dl = await downloadMedia(mediaUrl, token);
    const blob = new Blob([dl.buffer], { type: mime || dl.mime || "application/octet-stream" });
    const form = new FormData();
    form.append("model", DEFAULT_MODEL);
    form.append("file", blob, att.filename || fileNameFromMime(mime || dl.mime));

    const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!resp.ok) {
      logger.error({ msg: "AUDIO_TRANSCRIBE_FAILED", status: resp.status });
      return { ok: false, reason: `http_${resp.status}` };
    }
    const data = await resp.json();
    const text = (data?.text || "").trim();
    if (!text) return { ok: false, reason: "empty" };
    return { ok: true, text };
  } catch (err) {
    logger.error({ msg: "AUDIO_TRANSCRIBE_ERROR", err: err?.message });
    return { ok: false, reason: "exception" };
  }
}

