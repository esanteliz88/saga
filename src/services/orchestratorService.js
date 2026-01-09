/**
 * Orchestrator to decide which agent responds and when to trigger external actions.
 */
export function decideAgent({ session, question }) {
  if (session.status === "AWAITING_CONSENT") return "PRIMARY";
  if (session.status === "AWAITING_EXTERNAL") return "NURSE";
  if (question?.meta?.agent) return String(question.meta.agent).toUpperCase();
  if ((question?.blockId || "default").includes("medic")) return "MEDIC";
  if ((question?.blockId || "default").includes("evidence")) return "NURSE";
  return "PRIMARY";
}

export function buildExternalAction(block) {
  if (!block?.meta?.onCompleteAction) return null;
  const action = block.meta.onCompleteAction;
  return {
    type: "CALL_API",
    name: action.name || "external_action",
    payload: action.payload || {},
    endpoint: action.endpoint,
    method: action.method || "POST",
  };
}
