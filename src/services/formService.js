import { FormTemplate } from "../models/FormTemplate.js";

export async function getActiveFormByCode(code) {
  const forms = await FormTemplate.find({ code, isActive: true }).sort({ version: -1 }).limit(1).lean();
  const form = forms[0] || null;
  if (!form) return null;
  return normalizeForm(form);
}

export async function getActiveForms() {
  const forms = await FormTemplate.find({ isActive: true }).sort({ code: 1, version: -1 }).lean();
  return forms.map(normalizeForm);
}

export function buildAnswersIndex(session) {
  const idx = new Map();
  for (const a of session.answers || []) idx.set(a.qid, a);
  return idx;
}

function normalizeType(type) {
  if (type === "select_one") return "dropdown";
  return type || "text";
}

function normalizeShowIf(appliesWhen) {
  if (!appliesWhen || appliesWhen.op === "always") return undefined;
  if (appliesWhen.op === "eq") return { qid: appliesWhen.qid, equals: appliesWhen.value };
  return undefined;
}

function normalizeGroups(form) {
  const questions = [];
  const blocks = [];

  if (!Array.isArray(form.questionGroups)) return { questions: form.questions || [], blocks: form.blocks || [] };

  for (const group of form.questionGroups) {
    const blockId = group.groupId || "default";
    blocks.push({ id: blockId, name: group.title || blockId, description: group.description, meta: group.meta });

    for (const q of group.questions || []) {
      const showIf = q.appliesWhen ? normalizeShowIf(q.appliesWhen) : normalizeShowIf(group.appliesWhen);
      questions.push({
        qid: q.qid,
        label: q.label,
        type: normalizeType(q.type),
        required: !!q.required,
        description: q.description,
        options: q.options,
        showIf,
        meta: q.meta,
        blockId,
      });
    }
  }

  return { questions, blocks };
}

function normalizeForm(form) {
  if (form.questionGroups && form.questionGroups.length) {
    const { questions, blocks } = normalizeGroups(form);
    return { ...form, questions, blocks };
  }
  return form;
}

export function buildBlocks(form) {
  const blocks = [];
  const seen = new Set();
  for (const b of form.blocks || []) {
    if (!b?.id || seen.has(b.id)) continue;
    blocks.push({ id: b.id, name: b.name || b.id, description: b.description, meta: b.meta });
    seen.add(b.id);
  }
  for (const q of form.questions || []) {
    const bid = q.blockId || "default";
    if (seen.has(bid)) continue;
    blocks.push({ id: bid, name: bid, description: undefined, meta: undefined });
    seen.add(bid);
  }
  if (!blocks.length) blocks.push({ id: "default", name: "default" });
  return blocks;
}

export function isBlockCompleted(blockId, form, answersIndex) {
  const pending = (form.questions || []).some((q) => (q.blockId || "default") === blockId && canShowQuestion(q, answersIndex) && !answersIndex.has(q.qid));
  return !pending;
}

export function canShowQuestion(question, answersIndex) {
  const cond = question.showIf;
  if (!cond) return true;
  const prior = answersIndex.get(cond.qid);
  if (!prior) return false;

  const aVal = prior.value;
  const cVal = cond.equals;

  if (typeof aVal === "number" || typeof cVal === "number") return Number(aVal) === Number(cVal);
  return String(aVal) === String(cVal);
}

export function findNextQuestion(form, answersIndex) {
  for (const q of form.questions || []) {
    if (!canShowQuestion(q, answersIndex)) continue;
    if (!answersIndex.has(q.qid)) return q;
  }
  return null;
}

export function resolveCurrentQuestion(form, session) {
  const answersIndex = buildAnswersIndex(session);
  const blocks = buildBlocks(form);
  const current = session.currentQid ? (form.questions || []).find((q) => q.qid === session.currentQid) : null;

  if (current && canShowQuestion(current, answersIndex) && !answersIndex.has(current.qid)) {
    return { question: current, block: blocks.find((b) => b.id === (current.blockId || "default")) ?? blocks[0], answersIndex, blocks };
  }

  // pick first block with pending questions
  let targetBlock = null;
  for (const b of blocks) {
    const hasPending = (form.questions || []).some((q) => (q.blockId || "default") === b.id && canShowQuestion(q, answersIndex) && !answersIndex.has(q.qid));
    if (hasPending) { targetBlock = b; break; }
  }
  if (!targetBlock) return { question: null, block: null, answersIndex, blocks };

  const next = (form.questions || []).find((q) => (q.blockId || "default") === targetBlock.id && canShowQuestion(q, answersIndex) && !answersIndex.has(q.qid));
  return { question: next || null, block: targetBlock, answersIndex, blocks };
}
