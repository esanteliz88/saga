/**
 * Lightweight evidence validator to verify attachments and semantic alignment.
 */
const allowedMime = ["application/pdf", "image/jpeg", "image/png"];

export async function validateEvidence(question, attachments = [], session = null) {
  if (!attachments.length) return { ok: false, reason: "missing_attachment" };

  const invalidMime = attachments.find((a) => a.mime && !allowedMime.includes(a.mime.toLowerCase()));
  if (invalidMime) return { ok: false, reason: "invalid_mime" };

  const maxSize = question?.meta?.maxEvidenceSizeMb ? question.meta.maxEvidenceSizeMb * 1024 * 1024 : 10 * 1024 * 1024;
  const tooBig = attachments.find((a) => typeof a.size === "number" && a.size > maxSize);
  if (tooBig) return { ok: false, reason: "file_too_large" };

  // Semantic/consistency check via AI hook when enabled.
  if (question?.meta?.requiresSemanticCheck && session) {
    const { evaluateEvidenceSemantics } = await import("./aiService.js");
    const ai = await evaluateEvidenceSemantics({ session, question, attachments });
    if (!ai.ok) return { ok: false, reason: ai.reason || "semantic_mismatch" };
  }

  return { ok: true };
}
