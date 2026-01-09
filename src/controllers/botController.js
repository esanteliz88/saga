import { getActiveFormByCode, resolveCurrentQuestion, buildBlocks, getActiveForms } from "../services/formService.js";
import { getOrCreateSession, appendMemory, saveAnswer, restartSession, backOne, attachEvidenceToAnswer, recordBlockAttempt, markBlockDone, setPendingAction } from "../services/sessionService.js";
import { validateAnswer } from "../services/validationService.js";
import { renderConsentPrompt, renderQuestion, renderValidationError, renderCompleted, buildSummaryText, renderBlockIntro, renderBlockCompleted } from "../services/renderService.js";
import { parseCommand, isAffirmative, isNegative } from "../utils/commands.js";
import { decideAgent, buildExternalAction } from "../services/orchestratorService.js";
import { validateEvidence } from "../services/evidenceValidator.js";
import { evaluateAnswerRisk } from "../services/aiService.js";
import { generateLLMAnswer } from "../services/llmService.js";
import { transcribeAudioAttachment } from "../services/audioService.js";
import { logger } from "../utils/logger.js";
import { sendFinalizePayload, sendFilterPayload } from "../services/webhookService.js";
import { FormSession } from "../models/FormSession.js";
import { FormMemory } from "../models/FormMemory.js";

function safeAttachments(message) {
  const arr = message?.attachments || [];
  return arr.filter((a) => a && (a.url || a.id)).map((a) => ({
    url: a.url ? String(a.url) : undefined,
    kind: a.kind ? String(a.kind) : undefined,
    id: a.id ? String(a.id) : undefined,
    mime: a.mime ? String(a.mime) : undefined,
    filename: a.filename ? String(a.filename) : undefined,
    size: typeof a.size === "number" ? a.size : undefined
  }));
}

const MAX_LIST_ROWS = 10;
const PAGE_SIZE = 9;

function meta(session, formCode, currentQid, currentBlockId) {
  return { sessionStatus: session.status, currentQid: currentQid || session.currentQid || null, currentBlockId: currentBlockId || session.currentBlockId || null, formCode, wa_id: session.wa_id };
}

function isFormIntent(text) {
  const t = (text || "").toLowerCase();
  return ["formulario", "form", "llenar", "registrar", "encuesta", "solicitud"].some((k) => t.includes(k));
}

function isGreeting(text) {
  const t = (text || "").toLowerCase();
  return ["hola", "buenas", "hello", "hi", "hey"].some((k) => t.includes(k));
}

function extractDiagnosis(text) {
  const t = (text || "").toLowerCase();
  const m = t.match(/cancer\s+de\s+([a-z\s]+)/i);
  if (m) return `cancer de ${m[1].trim()}`;
  if (t.includes("cancer")) return "cancer (sin especificar)";
  return null;
}

function extractSetFormCode(text) {
  const t = (text || "").trim();
  if (t.toUpperCase().startsWith("SET_FORM:")) return t.slice("SET_FORM:".length).trim();
  const m = t.match(/^usar\s+([a-zA-Z0-9_\-]+)$/i);
  if (m) return m[1];
  return null;
}

function casualInviteText() {
  return `Cuando quieras avanzar con el formulario, dime "formulario" y te pregunto si prefieres web o WhatsApp. Sin apuro.`;
}

function isChoiceQuestion(question) {
  return ["dropdown", "single_choice", "select_one"].includes(question?.type);
}

function getOptionPages(session) {
  return (session.notes && session.notes.optionPages) || {};
}

async function setOptionPage(session, qid, page) {
  const pages = { ...getOptionPages(session), [qid]: page };
  session.notes = { ...(session.notes || {}), optionPages: pages };
  session.updatedAt = new Date();
  await session.save();
}

function buildPagedQuestion(question, session) {
  if (!question || !isChoiceQuestion(question)) return question;
  const options = question.options || [];
  if (options.length <= MAX_LIST_ROWS) return question;

  const pages = getOptionPages(session);
  let page = Number(pages[question.qid] || 0);
  const maxPage = Math.floor((options.length - 1) / PAGE_SIZE);
  if (page < 0 || page > maxPage) page = 0;

  const start = page * PAGE_SIZE;
  const slice = options.slice(start, start + PAGE_SIZE);
  const hasMore = start + PAGE_SIZE < options.length;
  const pagedOptions = hasMore
    ? [...slice, { label: "Ver mas", value: `MORE:${question.qid}:${page + 1}` }]
    : slice;

  return { ...question, options: pagedOptions };
}

function parseMoreToken(text) {
  if (!text) return null;
  const m = String(text).match(/^MORE:([^:]+):(\d+)$/);
  if (!m) return null;
  return { qid: m[1], page: Number(m[2]) };
}

async function getPatientProfileSummary(wa_id) {
  const sessions = await FormSession.find({ wa_id }).sort({ updatedAt: -1 }).limit(3).lean();
  if (!sessions.length) return null;
  const notes = sessions.map((s) => s.notes || {}).find((n) => n && n.diagnosis);
  const answers = (sessions[0].answers || []).slice(0, 5).map((a) => `${a.qid}: ${a.label ?? a.value}`).join("; ");
  const profileParts = [];
  if (notes?.diagnosis) profileParts.push(`Diagnostico mencionado: ${notes.diagnosis}`);
  if (answers) profileParts.push(`Ultimas respuestas: ${answers}`);
  return profileParts.join(" | ");
}

function buildAnswersSnapshot(session, form, max = 6) {
  const answers = (session.answers || []).slice(-max);
  if (!answers.length) return null;
  const byQid = new Map();
  for (const q of form.questions || []) byQid.set(q.qid, q.label);
  const lines = answers.map((a) => {
    const label = byQid.get(a.qid) || a.qid;
    const val = a.label ?? a.value;
    return `${label}: ${val ?? "N/D"}`;
  });
  return lines.join(" | ");
}

function normalizeTextValue(value) {
  if (value == null) return null;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  const raw = String(value).trim().toLowerCase();
  if (["si", "sí", "true"].includes(raw)) return "1";
  if (["no", "false"].includes(raw)) return "0";
  return raw;
}

function slugify(value) {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase();
  return raw
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toAnswerShape(value, blockName) {
  const answered = value != null && String(value).trim() !== "";
  return {
    value,
    isValid: answered,
    isAnswered: answered,
    isPending: false,
    validationErr: null,
    isCorrectIncorrectScreenDisplayed: false,
    isLocked: false,
    blockName: blockName || "dropdown",
  };
}

function getAnswerByQid(session, qid) {
  const a = (session.answers || []).find((x) => x.qid === qid);
  return a ? (a.label ?? a.value) : null;
}

function formatDateForFilter(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function buildFilterPayload(session, form) {
  const enfermedad = slugify(getAnswerByQid(session, "q1"));
  const metastasis = normalizeTextValue(getAnswerByQid(session, "q7"));
  const cirugiaRaw = normalizeTextValue(getAnswerByQid(session, "q9"));
  const cirugia = cirugiaRaw === "1" ? "1" : (cirugiaRaw === "0" ? "0" : "1");
  const tratamiento = getAnswerByQid(session, "q12") ? "1" : "0";
  const sexo = slugify(getAnswerByQid(session, "q16"));
  const region = slugify(getAnswerByQid(session, "q18"));
  const dolor = normalizeTextValue(getAnswerByQid(session, "q14"));
  const descanso = normalizeTextValue(getAnswerByQid(session, "q14_2"));
  const actividad = normalizeTextValue(getAnswerByQid(session, "q15"));
  const nombre = getAnswerByQid(session, "q19");
  const email = getAnswerByQid(session, "q20");
  const telefono = getAnswerByQid(session, "q21");
  const fechaCirugia = formatDateForFilter(getAnswerByQid(session, "q10"));
  const detallesCirugia = getAnswerByQid(session, "q11");

  return {
    answers: {
      enfermedad: toAnswerShape(enfermedad, "dropdown"),
      metastasis: toAnswerShape(metastasis, "dropdown"),
      cirugia: toAnswerShape(cirugia, "dropdown"),
      tratamiento: toAnswerShape(tratamiento, "dropdown"),
      guiasSeleccionadas: toAnswerShape(
        [process.env.FILTER_DEFAULT_GUIDE || "info-general"],
        "multiple-choice"
      ),
      terminos: toAnswerShape("si-acepto", "dropdown"),
      sexoDelPaciente: toAnswerShape(sexo, "dropdown"),
      paisDelPaciente: toAnswerShape(process.env.FILTER_DEFAULT_COUNTRY || "chile", "dropdown"),
      regionDelPaciente: toAnswerShape(region, "dropdown"),
      ciudadDelPaciente: toAnswerShape(null, "short-text"),
      dolorSintomas: toAnswerShape(dolor, "dropdown"),
      descansoEnCama: toAnswerShape(descanso, "dropdown"),
      actividadDiaria: toAnswerShape(actividad, "dropdown"),
      nombre: { value: nombre, isValid: !!nombre, validationErr: null },
      email: { value: email, isValid: !!email, validationErr: null },
      telefono: { value: telefono, isValid: !!telefono, validationErr: null },
      tipoDeCancerPulmon: toAnswerShape(null, "dropdown"),
      fechaCirugia: toAnswerShape(fechaCirugia, "date"),
      detallesCirugia: toAnswerShape(detallesCirugia, "long-text"),
      subtipo: { value: null },
      user: { id: null, nombre: null, email: null, telefono: null },
      origenFormulario: { value: "guias" },
      nombreFormulario: "filter",
    },
  };
}

async function getRecentConversation(wa_id, formCode, limit = 6) {
  const mem = await FormMemory.findOne({ wa_id, formCode }).lean();
  const events = mem?.events || [];
  const recent = events.slice(-limit).map((e) => `${e.direction === "IN" ? "Usuario" : "Bot"}: ${e.text || ""}`.trim()).join("\n");
  return recent || null;
}

async function requestDeletion(wa_id, formCode) {
  const purgeDate = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);
  const sess = await FormSession.findOne({ wa_id, formCode });
  if (sess) {
    sess.deleteRequestedAt = new Date();
    sess.deletePurgeAt = purgeDate;
    await sess.save();
  }
  const mem = await FormMemory.findOne({ wa_id, formCode });
  if (mem) {
    mem.deleteRequestedAt = new Date();
    mem.deletePurgeAt = purgeDate;
    await mem.save();
  }
  return purgeDate;
}

function matchOptionSimple(question, text) {
  const norm = (text || "").trim().toLowerCase();
  if (!norm) return null;
  for (const o of question.options || []) {
    const l = String(o.label || "").trim().toLowerCase();
    const v = String(o.value ?? "").trim().toLowerCase();
    if (!l && !v) continue;
    if (l === norm || v === norm) return { value: o.value, label: o.label };
    if (l.includes(norm) || norm.includes(l)) return { value: o.value, label: o.label };
  }
  return null;
}

async function llmCoerceOption(question, text) {
  if (!text || !(question.options || []).length) return null;
  const simple = matchOptionSimple(question, text);
  if (simple) return simple;
  const list = (question.options || []).map((o, idx) => `${idx + 1}) label="${o.label}" value="${o.value}"`).join("\n");
  const prompt =
    "Dada la respuesta del usuario, elige la opcion mas cercana de la lista. " +
    "Devuelve SOLO el value exacto de la opcion, o NONE si no coincide.\n" +
    list +
    `\nRespuesta del usuario: "${text}"\nValue elegido:`;
  const ai = await generateLLMAnswer({ prompt, systemPrompt: "Eres un normalizador de opciones. Devuelve solo el value exacto o NONE." });
  if (!ai.ok) return null;
  const choice = (ai.text || "").trim().split(/\s/)[0];
  if (!choice || choice.toUpperCase() === "NONE") return null;
  const match = (question.options || []).find((o) => String(o.value).toLowerCase() === choice.toLowerCase() || String(o.label).toLowerCase() === choice.toLowerCase());
  if (!match) return null;
  return { value: match.value, label: match.label };
}

export async function handleBotMessage(req, res) {
console.log("Received bot message");
  console.log(req.body);
  console.log(res)
  const payload = req.body || {};
  const channel = payload.channel || "unknown";
  const user = payload.user || {};
  const msg = payload.message || {};

  const wa_id = String(user.wa_id || "").trim();
  if (!wa_id) return res.status(400).json({ error: "missing_user.wa_id" });

  let formCode = payload.formCode || process.env.FORM_CODE || "guia_salud";
  let form = await getActiveFormByCode(formCode);
  if (!form) {
    const list = await getActiveForms();
    const names = list.map((f) => `- ${f.code}: ${f.name || ""}`.trim()).join("\n");
    return res.status(404).json({ error: "form_not_found", detail: `No existe formulario activo con code=${formCode}`, available: names });
  }

  let { session, memory } = await getOrCreateSession({ wa_id, name: user.name, channel, formCode });
  const atts = safeAttachments(msg);
  const agent = decideAgent({ session, question: null });
  logger.info({ msg: "INCOMING", wa_id, formCode, status: session.status, text: msg.text, attachments: atts.length });

  const incomingId = msg.id || msg.message_id;
  if (incomingId && (memory?.events || []).some((e) => e.direction === "IN" && e.messageId === incomingId)) {
    logger.info({ msg: "DUPLICATE_INCOMING", wa_id, messageId: incomingId });
    return res.json({});
  }

  // Log IN
  await appendMemory(memory, { direction: "IN", messageId: incomingId, type: msg.type || "text", text: msg.text, attachments: atts, agent });

  // Commands
  const command = parseCommand(msg.text);
  const setFormCode = extractSetFormCode(msg.text);
  const diagnosisMention = extractDiagnosis(msg.text);

  if (diagnosisMention) {
    session.notes = { ...(session.notes || {}), diagnosis: diagnosisMention };
    session.updatedAt = new Date();
    await session.save();
    logger.info({ msg: "NOTED_DIAGNOSIS", wa_id, diagnosis: diagnosisMention });
  }

  if (command === "FORM_LIST") {
    const forms = await getActiveForms();
    const text = forms.length ? forms.map((f) => `- ${f.code}: ${f.name || ""}`).join("\n") : "No hay formularios activos.";
    const buttons = forms.slice(0, 10).map((f) => ({ label: f.name || f.code, value: `SET_FORM:${f.code}` }));
    const out = { text: `Formularios disponibles:\n${text}\n\nElige uno para usarlo.`, buttons };
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
    return res.json({ reply: { ...out, meta: meta(session, formCode) }, actions: [] });
  }

  if (setFormCode) {
    const nextForm = await getActiveFormByCode(setFormCode);
    if (!nextForm) {
      const out = { text: `No encontr® formulario con code=${setFormCode}. Escribe "formularios" para ver la lista.`, buttons: [] };
      await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
      return res.json({ reply: { ...out, meta: meta(session, formCode) }, actions: [] });
    }
    formCode = setFormCode;
    form = nextForm;
    ({ session, memory } = await getOrCreateSession({ wa_id, name: user.name, channel, formCode }));
    logger.info({ msg: "FORM_SWITCHED", wa_id, formCode });
  }

  if (command === "FORM_WEB") {
    const url = process.env.FORM_WEB_URL || "https://example.com/form";
    const out = {
      text: `Aqu¡ tienes el formulario web: ${url}\n\nSi prefieres, puedo ayudarte a completarlo por chat. Solo di "formulario" o "empezar por chat".`,
      buttons: [{ label: "Completar por chat", value: "START_FORM" }]
    };
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
    return res.json({ reply: { ...out, meta: meta(session, formCode) }, actions: [] });
  }
  if (command === "FORM_WS" || command === "START_FORM") {
    await restartSession(session);
    const consent = renderConsentPrompt(session.name);
    session.status = "AWAITING_CONSENT";
    session.consentPrompted = true;
    await session.save();
    await appendMemory(memory, { direction: "OUT", type: "text", text: consent.text, agent: "SYSTEM" });
    return res.json({ reply: { ...consent, meta: meta(session, formCode) }, actions: [] });
  }

  if (command === "RESTART") {
    await restartSession(session);
    const consent = renderConsentPrompt(session.name);
    await appendMemory(memory, { direction: "OUT", type: "text", text: consent.text, agent: "SYSTEM" });
    return res.json({ reply: { ...consent, meta: meta(session, formCode) }, actions: [] });
  }
  if (command === "BACK") {
    await backOne(session);
    session.status = "IN_PROGRESS";
    await session.save();
    const { question, block } = resolveCurrentQuestion(form, session);
    const paged = buildPagedQuestion(question, session);
    const out = paged ? renderQuestion(paged) : { text: "No hay preguntas pendientes.", buttons: [] };
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: decideAgent({ session, question }) });
    return res.json({ reply: { ...out, meta: meta(session, formCode, paged?.qid, block?.id) }, actions: [] });
  }
  if (command === "STATUS") {
    const { question, block } = resolveCurrentQuestion(form, session);
    const out = question ? { text: `Vas en: ${question.qid} (bloque ${block?.id || "default"})\n${question.label}`, buttons: [] } : { text: "No hay preguntas pendientes.", buttons: [] };
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
    return res.json({ reply: { ...out, meta: meta(session, formCode, question?.qid, block?.id) }, actions: [] });
  }
  if (command === "HANDOFF") {
    session.status = "HANDOFF";
    await session.save();
    const out = { text: "Perfecto. Te derivare con un humano para continuar.", buttons: [] };
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
    return res.json({ reply: { ...out, meta: meta(session, formCode) }, actions: [{ type: "HANDOFF" }] });
  }
  if (command === "PAUSE") {
    session.status = "AWAITING_EXTERNAL";
    await session.save();
    const out = { text: "Pausado. Cuando quieras seguir, escribe 'reanudar'.", buttons: [] };
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
    return res.json({ reply: { ...out, meta: meta(session, formCode) }, actions: [] });
  }
  if (command === "RESUME") {
    session.status = "IN_PROGRESS";
    await session.save();
    const { question, block } = resolveCurrentQuestion(form, session);
    const paged = buildPagedQuestion(question, session);
    const out = paged ? renderQuestion(paged) : { text: "No hay preguntas pendientes.", buttons: [] };
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: decideAgent({ session, question }) });
    return res.json({ reply: { ...out, meta: meta(session, formCode, paged?.qid, block?.id) }, actions: [] });
  }
  if (command === "REQUEST_REVIEW") {
    session.status = "PENDING_REVIEW";
    await session.save();
    const out = { text: "He enviado tu caso a revision humana. Espera un momento por favor.", buttons: [] };
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
    return res.json({ reply: { ...out, meta: meta(session, formCode) }, actions: [{ type: "HANDOFF" }] });
  }
  if (command === "BLOCK_STATUS") {
    const blocks = buildBlocks(form);
    const lines = blocks.map((b) => {
      const st = (session.blockStatuses || []).find((x) => x.blockId === b.id);
      return `- ${b.id}: ${st?.status || "PENDING"} (intentos: ${st?.attempts || 0})`;
    }).join("\n");
    const out = { text: lines || "Sin informacion de bloques.", buttons: [] };
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
    return res.json({ reply: { ...out, meta: meta(session, formCode) }, actions: [] });
  }
  if (command === "CHAT") {
    session.status = "AWAITING_CONSENT";
    session.currentQid = undefined;
    session.notes = { ...(session.notes || {}), chatFree: true };
    await session.save();
    const out = {
      text: "Modo chat libre activado. Pregunta lo que necesites o pide 'formulario' si quieres retomarlo o empezar uno nuevo.",
      buttons: [
        { label: "Formulario web", value: "FORM_WEB" },
        { label: "Formulario por chat", value: "START_FORM" }
      ]
    };
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
    return res.json({ reply: { ...out, meta: meta(session, formCode) }, actions: [] });
  }
  if (command === "DELETE_DATA") {
    const purgeDate = await requestDeletion(wa_id, formCode);
    const out = { text: `He recibido tu solicitud de borrar tus datos. Har® un borrado suave y en 15 d¡as se purgarín por completo (fecha estimada: ${purgeDate.toISOString().slice(0,10)}). Mientras tanto, no se usarín para nuevas interacciones.`, buttons: [] };
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
    return res.json({ reply: { ...out, meta: meta(session, formCode) }, actions: [] });
  }

  // Consent
  if (session.status === "AWAITING_CONSENT") {
    const consentYes = isAffirmative(msg.text) || String(msg.text).toUpperCase().includes("SI_ACEPTO");
    const consentNo = isNegative(msg.text) || String(msg.text).toUpperCase() === "NO";

    if (consentYes) {
      session.status = "IN_PROGRESS";
      session.currentQid = undefined;
      await session.save();
      let { question, block } = resolveCurrentQuestion(form, session);
      if (!question && (form.questions || []).length) {
        await restartSession(session);
        ({ question, block } = resolveCurrentQuestion(form, session));
      }
      const intro = block ? renderBlockIntro(block) : null;
      const paged = buildPagedQuestion(question, session);
      const out = paged ? renderQuestion(paged) : {
        text: "No hay preguntas configuradas. Si prefieres, usa el formulario web o reinicia con 'reiniciar'.",
        buttons: [{ label: "Formulario web", value: "FORM_WEB" }]
      };
      const mergedText = intro ? `${intro.text}\n\n${out.text}` : out.text;
      await appendMemory(memory, { direction: "OUT", type: "text", text: mergedText, agent: decideAgent({ session, question }) });
      return res.json({ reply: { ...out, text: mergedText, meta: meta(session, formCode, paged?.qid, block?.id) }, actions: [] });
    }
    if (consentNo) {
      session.status = "CANCELLED";
      await session.save();
      const out = { text: "Entendido. Sin consentimiento no puedo continuar. Si cambias de opinion, escribe 'reiniciar'.", buttons: [] };
      await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
      return res.json({ reply: { ...out, meta: meta(session, formCode) }, actions: [] });
    }

    // Chat libre sin consentimiento cuando chatFree=true
    if (session.notes?.chatFree && !isFormIntent(msg.text) && !consentYes) {
      const profile = await getPatientProfileSummary(wa_id);
      const answersSnapshot = buildAnswersSnapshot(session, form);
      const convo = await getRecentConversation(wa_id, formCode, 6);
      const ai = await generateLLMAnswer({
        prompt: msg.text,
        systemPrompt:
          "Eres un asistente de salud empatico y claro. Responde breve, sin diagnosticar ni dar tratamientos. " +
          "Solo brinda orientacion y responde preguntas de medicina general." +
          (session.notes?.diagnosis ? `\nEl usuario menciono previamente: ${session.notes.diagnosis}.` : "") +
          (answersSnapshot ? `\nRespuestas actuales: ${answersSnapshot}` : "") +
          (profile ? `\nContexto previo: ${profile}` : "") +
          (convo ? `\nHistorial reciente:\n${convo}` : ""),
      });
      const answerText = ai.ok ? ai.text : "Puedo ayudarte con orientacion general. Si quieres, pide 'formulario' para completarlo.";
      const url = process.env.FORM_WEB_URL || "https://example.com/form";
      const cta = `Si quieres completar datos, te paso el link web (${url}) o lo hacemos por chat (di 'formulario').`;
      const out = { text: [answerText, cta].join("\n\n"), buttons: [{ label: "Formulario web", value: "FORM_WEB" }, { label: "Formulario por chat", value: "START_FORM" }] };
      await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
      return res.json({ reply: { ...out, meta: meta(session, formCode) }, actions: [] });
    }

    if (!consentYes && !consentNo && !isFormIntent(msg.text)) {
      const greet = isGreeting(msg.text);
      let answerText = null;
      const profile = await getPatientProfileSummary(wa_id);
      const answersSnapshot = buildAnswersSnapshot(session, form);
      const convo = await getRecentConversation(wa_id, formCode, 6);
      if (msg.text && msg.text.trim().length > 0) {
        const ai = await generateLLMAnswer({
          prompt: msg.text,
          systemPrompt:
            "Eres un asistente de salud empatico y claro. Responde breve, sin diagnosticar ni dar tratamientos. " +
            "Solo brinda orientacion y responde preguntas de medicina general. No ofrezcas formularios a menos que te lo pidan." +
            (session.notes?.diagnosis ? `\nEl usuario menciono previamente: ${session.notes.diagnosis}.` : "") +
            (answersSnapshot ? `\nRespuestas actuales: ${answersSnapshot}` : "") +
            (profile ? `\nContexto previo: ${profile}` : "") +
            (convo ? `\nHistorial reciente:\n${convo}` : ""),
        });
        logger.info({ msg: "LLM_INITIAL_REPLY", wa_id, ok: ai.ok, reason: ai.reason });
        if (ai.ok) {
          answerText = ai.text;
        } else if (msg.text.trim().length > 8) {
          answerText = "Puedo darte orientacion general y, si quieres, completar tus datos para pasarlos al equipo.";
        }
      }
      if (!answerText && msg.text) {
        const lower = msg.text.toLowerCase();
        if (lower.includes("cancer")) {
          const prev = session.notes?.diagnosis ? `Recuerdo que mencionaste: ${session.notes.diagnosis}. ` : "";
          answerText = `${prev}El cancer es un grupo de enfermedades donde algunas celulas crecen sin control y pueden diseminarse. El manejo depende del tipo y etapa y siempre debe verlo un equipo clinico.`;
        }
      }
      if (!answerText) {
        answerText = greet ? `Hola${session.name ? " " + session.name : ""}, en qu® puedo ayudarte?` : "En qu® puedo ayudarte hoy?";
      }
      const url = process.env.FORM_WEB_URL || "https://example.com/form";
      const cta = `Si quieres, puedo abrir el formulario: te paso el link web (${url}) o lo completamos aqu¡ paso a paso.`;
      const text = [answerText, cta].join("\n\n");
      const buttons = [
        { label: "Web", value: "FORM_WEB" },
        { label: "WhatsApp", value: "FORM_WS" }
      ];
      session.consentPrompted = true;
      session.updatedAt = new Date();
      await session.save();
      const out = { text, buttons };
      await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
      return res.json({ reply: { ...out, meta: meta(session, formCode) }, actions: [] });
    }

    const consent = renderConsentPrompt(session.name);
    logger.info({ msg: "SEND_CONSENT", wa_id });
    await appendMemory(memory, { direction: "OUT", type: "text", text: consent.text, agent: "SYSTEM" });
    return res.json({ reply: { ...consent, meta: meta(session, formCode) }, actions: [] });
  }

  // If not in progress
  if (session.status === "PENDING_REVIEW") {
    const out = { text: "Tu formulario quedo pendiente de revision. Un humano debe revisarlo antes de continuar.", buttons: [] };
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
    return res.json({ reply: { ...out, meta: meta(session, formCode) }, actions: [{ type: "HANDOFF" }] });
  }

  if (session.status !== "IN_PROGRESS") {
    const out = {
      text: `Hola. Tu sesion esta en estado: ${session.status}. Elige que hacer:`,
      buttons: [
        { label: "Chatear", value: "CHAT" },
        { label: "Nuevo formulario", value: "START_FORM" },
        { label: "Reiniciar actual", value: "RESTART" }
      ]
    };
    logger.info({ msg: "STATUS_NOT_IN_PROGRESS", wa_id, status: session.status });
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
    return res.json({ reply: { ...out, meta: meta(session, formCode) }, actions: [] });
  }

  // Current question
  const { question, block } = resolveCurrentQuestion(form, session);
  const audioAtt = atts.find((a) => a.kind === "audio");
  if (!msg.text && audioAtt && question) {
    const tx = await transcribeAudioAttachment(audioAtt);
    if (tx.ok && tx.text) {
      msg.text = tx.text;
      logger.info({ msg: "AUDIO_TRANSCRIBED", wa_id, qid: question.qid, textLen: tx.text.length });
    } else {
      const out = { text: "No pude procesar el audio. Por favor responde con texto o botones.", buttons: [] };
      await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
      return res.json({ reply: { ...out, meta: meta(session, formCode, question.qid, block?.id) }, actions: [] });
    }
  }
  if (!msg.text && atts.length > 0 && question && !question.meta?.requiresEvidence) {
    const out = { text: "Recibi un archivo, pero necesito tu respuesta en texto o con botones para continuar.", buttons: [] };
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
    return res.json({ reply: { ...out, meta: meta(session, formCode, question.qid, block?.id) }, actions: [] });
  }
  const more = parseMoreToken(msg.text);
  if (more && question && more.qid === question.qid && isChoiceQuestion(question)) {
    await setOptionPage(session, question.qid, more.page);
    const paged = buildPagedQuestion(question, session);
    const out = paged ? renderQuestion(paged) : { text: "No hay preguntas pendientes.", buttons: [] };
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: decideAgent({ session, question }) });
    return res.json({ reply: { ...out, meta: meta(session, formCode, question?.qid, block?.id) }, actions: [] });
  }
  if (!question) {
    session.status = "COMPLETED";
    await session.save();
    const summary = process.env.RETURN_SUMMARY_ON_COMPLETE === "true" ? buildSummaryText(session, form) : null;
    const out = renderCompleted(form, summary);
    const payload = {
      wa_id: session.wa_id,
      formCode,
      status: session.status,
      answers: session.answers,
      blockStatuses: session.blockStatuses,
      meta: { completedAt: new Date().toISOString() }
    };
    await sendFinalizePayload(payload);
    const filterPayload = buildFilterPayload(session, form);
    await sendFilterPayload(filterPayload);
    const finalText = [out.text, "Que prefieres ahora?"].filter(Boolean).join(\"\n\n\");
    const buttons = [
      { label: "Nuevo formulario", value: "START_FORM" },
      { label: "Chatear", value: "CHAT" },
      { label: "Ver resumen", value: "SUMMARY" },
      { label: "Reiniciar", value: "RESTART" }
    ];
    await appendMemory(memory, { direction: "OUT", type: "text", text: finalText, agent: decideAgent({ session, question: null }) });
    return res.json({ reply: { ...out, text: finalText, buttons, meta: meta(session, formCode) }, actions: [] });
  }

  session.currentBlockId = block?.id || "default";
  await session.save();

  // Attachments become evidence for current question
  if (atts.length) await attachEvidenceToAnswer(session, question.qid, atts);

  // Validate
  const result = validateAnswer(question, { type: msg.type, text: msg.text, attachments: atts });
  let validated = result;

  // LLM fallback for options
  if (!validated.ok && validated.error === "invalid_option" && msg.text && (question.options || []).length) {
    const coerced = await llmCoerceOption(question, msg.text);
    if (coerced) {
      validated = { ok: true, value: coerced.value, label: coerced.label, raw: msg.text };
      logger.info({ msg: "LLM_OPTION_COERCED", wa_id, qid: question.qid, value: coerced.value });
    }
  }

  if (!validated.ok) {
    await recordBlockAttempt(session, block?.id);
    if (session.status === "PENDING_REVIEW") {
      const out = { text: "Alcanzaste el limite de intentos. Derivare tu caso a un humano.", buttons: [] };
      await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "SYSTEM" });
      return res.json({ reply: { ...out, meta: meta(session, formCode, question.qid, block?.id) }, actions: [{ type: "HANDOFF" }] });
    }
    const paged = buildPagedQuestion(question, session);
    const out = renderValidationError(paged, validated.error);
    await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: decideAgent({ session, question }) });
    logger.info({ msg: "VALIDATION_FAIL", wa_id, qid: question.qid, error: validated.error });
    return res.json({ reply: { ...out, meta: meta(session, formCode, question.qid, block?.id) }, actions: [] });
  }

  // AI risk/consistency check on validated answer
  if (question.meta?.riskCheck) {
    const aiRisk = await evaluateAnswerRisk({ session, question, answer: validated });
    logger.info({ msg: "RISK_CHECK", wa_id, qid: question.qid, ok: aiRisk.ok, reason: aiRisk.reason });
    if (!aiRisk.ok) {
      session.status = "PENDING_REVIEW";
      await session.save();
      const out = { text: "Detecte que esta respuesta requiere revision humana. Derivare tu caso.", buttons: [] };
      await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "MEDIC" });
      return res.json({ reply: { ...out, meta: meta(session, formCode, question.qid, block?.id) }, actions: [{ type: "HANDOFF" }] });
    }
  }

  // Validate evidence when required by meta
  if (question.meta?.requiresEvidence && atts.length) {
    const ev = await validateEvidence(question, atts, session);
    if (!ev.ok) {
      await recordBlockAttempt(session, block?.id);
      if (session.status === "PENDING_REVIEW") {
        const out = { text: "Los documentos no pasaron la verificacion. Enviaremos a revision humana.", buttons: [] };
        logger.warn({ msg: "EVIDENCE_FAIL_REVIEW", wa_id, qid: question.qid, reason: ev.reason });
        await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "NURSE" });
        return res.json({ reply: { ...out, meta: meta(session, formCode, question.qid, block?.id) }, actions: [{ type: "HANDOFF" }] });
      }
      const out = { text: `Los archivos no son validos (${ev.reason}). Intenta nuevamente.`, buttons: [] };
      logger.warn({ msg: "EVIDENCE_FAIL_RETRY", wa_id, qid: question.qid, reason: ev.reason });
      await appendMemory(memory, { direction: "OUT", type: "text", text: out.text, agent: "NURSE" });
      return res.json({ reply: { ...out, meta: meta(session, formCode, question.qid, block?.id) }, actions: [] });
    }
  }

  // Save answer (text or null if only evidence)
  if (msg.text && String(msg.text).trim().length) {
    await saveAnswer(session, { qid: question.qid, value: validated.value, label: validated.label, raw: validated.raw });
  } else {
    await saveAnswer(session, { qid: question.qid, value: null, label: null, raw: null });
  }
  if (session.notes?.optionPages && session.notes.optionPages[question.qid] !== undefined) {
    const pages = { ...session.notes.optionPages };
    delete pages[question.qid];
    session.notes = { ...(session.notes || {}), optionPages: pages };
  }

  session.currentQid = undefined;
  await session.save();

  // Next question and block handling
  const currentBlockId = block?.id || "default";
  const { question: next, block: nextBlock } = resolveCurrentQuestion(form, session);
  const actions = [];
  const texts = [];

  // Block complete transition
  if (!next || (nextBlock && nextBlock.id !== currentBlockId)) {
    await markBlockDone(session, currentBlockId);
    texts.push(renderBlockCompleted(block || { id: currentBlockId }).text);
    const externalAction = buildExternalAction(block);
    if (externalAction) {
      await setPendingAction(session, currentBlockId, externalAction);
      actions.push(externalAction);
    }
    if (nextBlock) texts.push(renderBlockIntro(nextBlock).text);
  }

  if (!next) {
    session.status = "COMPLETED";
    await session.save();
    const summary = process.env.RETURN_SUMMARY_ON_COMPLETE === "true" ? buildSummaryText(session, form) : null;
    const out = renderCompleted(form, summary);
    const payload = {
      wa_id: session.wa_id,
      formCode,
      status: session.status,
      answers: session.answers,
      blockStatuses: session.blockStatuses,
      meta: { completedAt: new Date().toISOString() }
    };
    await sendFinalizePayload(payload);
    const filterPayload = buildFilterPayload(session, form);
    await sendFilterPayload(filterPayload);
    const finalText = [out.text, "Que prefieres ahora?"].filter(Boolean).join(\"\n\n\");
    const buttons = [
      { label: "Nuevo formulario", value: "START_FORM" },
      { label: "Chatear", value: "CHAT" },
      { label: "Ver resumen", value: "SUMMARY" },
      { label: "Reiniciar", value: "RESTART" }
    ];
    await appendMemory(memory, { direction: "OUT", type: "text", text: finalText, agent: decideAgent({ session, question: null }) });
    return res.json({ reply: { ...out, text: finalText, buttons, meta: meta(session, formCode) }, actions });
  }

  const pagedNext = buildPagedQuestion(next, session);
  const rendered = renderQuestion(pagedNext);
  const combinedText = [...texts, rendered.text].filter(Boolean).join("\n\n");
  logger.info({ msg: "ASK_NEXT", wa_id, nextQid: next.qid, nextBlock: nextBlock?.id, actionsCount: actions.length });
  await appendMemory(memory, { direction: "OUT", type: "text", text: combinedText, agent: decideAgent({ session, question: next }) });
  return res.json({ reply: { ...rendered, text: combinedText, meta: meta(session, formCode, next.qid, nextBlock?.id) }, actions });
}
