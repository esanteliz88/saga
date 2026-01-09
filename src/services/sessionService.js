import { FormSession } from "../models/FormSession.js";
import { FormMemory } from "../models/FormMemory.js";
import { sendWhatsAppMessage } from "./fbService.js";
import { logger } from "../utils/logger.js";

function ensureBlockStatus(session, blockId) {
  if (!blockId) return null;
  const found = (session.blockStatuses || []).find((b) => b.blockId === blockId);
  if (found) return found;
  const block = { blockId, status: "PENDING", attempts: 0 };
  session.blockStatuses.push(block);
  return block;
}

export async function getOrCreateSession({ wa_id, name, channel, formCode }) {
  let session = await FormSession.findOne({ wa_id, formCode });
  if (!session) {
    session = await FormSession.create({ wa_id, name, channel, formCode, status: "AWAITING_CONSENT" });
  } else {
    session.name = name || session.name;
    session.channel = channel || session.channel;
    session.updatedAt = new Date();
    await session.save();
  }

  let memory = await FormMemory.findOne({ wa_id, formCode });
  if (!memory) memory = await FormMemory.create({ wa_id, formCode, events: [] });

  return { session, memory };
}

export async function appendMemory(memory, event) {
  memory.events.push(event);
  memory.updatedAt = new Date();
  await memory.save();
  try {
    // If this is an outgoing event and FB sending is enabled, forward to WhatsApp API
    if (event && event.direction === "OUT") {
      const to = memory.wa_id || (memory && memory.waId) || null;
      if (to) {
        // Map event to a simple structure for fbService
        const ev = { type: event.type || "text", text: event.text || (event.reply && event.reply.text) || "", buttons: event.buttons || [] };
        logger.info({ msg: "FB_SEND_ATTEMPT", to, event: ev });
        // send and log result
        sendWhatsAppMessage(to, ev)
          .then((r) => {
            logger.info({ msg: "FB_SEND_RESULT", to, ok: r?.ok, result: r });
          })
          .catch((err) => {
            logger.error({ msg: "FB_SEND_EXCEPTION", to, err: err?.message || err });
          });
      } else {
        logger.warn({ msg: "FB_SEND_NO_TARGET", event });
      }
    }
  } catch (e) {
    logger.error({ msg: "FB_SEND_INTERNAL_ERROR", err: e?.message || e });
  }
}

export function getBlockStatus(session, blockId) {
  return (session.blockStatuses || []).find((b) => b.blockId === blockId) || null;
}

export async function recordBlockAttempt(session, blockId, maxAttempts = 3) {
  if (!blockId) return session;
  const block = ensureBlockStatus(session, blockId);
  block.attempts = (block.attempts || 0) + 1;
  block.status = "IN_PROGRESS";
  session.currentBlockId = blockId;
  if (block.attempts >= maxAttempts) {
    block.status = "NEEDS_REVIEW";
    session.status = "PENDING_REVIEW";
  }
  session.updatedAt = new Date();
  await session.save();
  return session;
}

export async function markBlockDone(session, blockId) {
  if (!blockId) return session;
  const block = ensureBlockStatus(session, blockId);
  block.status = "DONE";
  session.currentBlockId = undefined;
  session.updatedAt = new Date();
  await session.save();
  return session;
}

export async function setPendingAction(session, blockId, action) {
  if (!blockId) return session;
  const block = ensureBlockStatus(session, blockId);
  block.pendingAction = action;
  block.status = "IN_PROGRESS";
  session.status = "AWAITING_EXTERNAL";
  session.updatedAt = new Date();
  await session.save();
  return session;
}

export async function saveAnswer(session, answerPatch) {
  const i = (session.answers || []).findIndex((a) => a.qid === answerPatch.qid);
  if (i >= 0) {
    session.answers[i] = { ...(session.answers[i].toObject?.() ?? session.answers[i]), ...answerPatch, ts: new Date() };
  } else {
    session.answers.push({ ...answerPatch, ts: new Date() });
  }
  session.updatedAt = new Date();
  await session.save();
}

export async function attachEvidenceToAnswer(session, qid, attachments = []) {
  const i = (session.answers || []).findIndex((a) => a.qid === qid);
  if (i >= 0) {
    const prev = session.answers[i].evidence || [];
    session.answers[i].evidence = [...prev, ...attachments.map((a) => ({ ...a, ts: new Date() }))];
  } else {
    session.answers.push({ qid, value: null, label: null, raw: null, evidence: attachments.map((a) => ({ ...a, ts: new Date() })) });
  }
  session.updatedAt = new Date();
  await session.save();
}

export async function restartSession(session) {
  session.status = "AWAITING_CONSENT";
  session.currentQid = undefined;
  session.answers = [];
  session.blockStatuses = [];
  session.currentBlockId = undefined;
  session.consentPrompted = false;
  session.updatedAt = new Date();
  await session.save();
}

export async function backOne(session) {
  if (!session.answers || session.answers.length === 0) return;
  session.answers.pop();
  session.currentQid = undefined;
  session.currentBlockId = undefined;
  session.updatedAt = new Date();
  await session.save();
}
