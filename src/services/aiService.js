/**
 * AI adapter (stub) to evaluate semantic consistency or risk.
 * Replace the body of callExternalAI with your API (LLM/vision model).
 */

async function callExternalAI(payload) {
  // Placeholder: return success. Swap with real HTTP call to your AI service.
  return { ok: true, score: 0.9, reason: "AI_STUB_OK" };
}

export async function evaluateEvidenceSemantics({ session, question, attachments }) {
  if (!question?.meta?.requiresSemanticCheck) return { ok: true, reason: "NO_SEMANTIC_CHECK" };
  return callExternalAI({
    type: "evidence_semantics",
    question,
    attachments,
    patient: { wa_id: session.wa_id, answers: session.answers },
  });
}

export async function evaluateAnswerRisk({ session, question, answer }) {
  if (!question?.meta?.riskCheck) return { ok: true, reason: "NO_RISK_CHECK" };
  return callExternalAI({
    type: "answer_risk",
    question,
    answer,
    patient: { wa_id: session.wa_id, answers: session.answers },
  });
}
