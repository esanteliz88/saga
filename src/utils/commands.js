export function parseCommand(textRaw) {
  const text = (textRaw || "").trim().toLowerCase();
  if (!text) return null;
  const normalized = text.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  const map = new Map([
    ["reiniciar", "RESTART"],
    ["reset", "RESTART"],
    ["volver", "BACK"],
    ["atras", "BACK"],
    ["atrケs", "BACK"],
    ["estado", "STATUS"],
    ["humano", "HANDOFF"],
    ["agente", "HANDOFF"],
    ["operador", "HANDOFF"],
    ["pausar", "PAUSE"],
    ["reanudar", "RESUME"],
    ["revisar", "REQUEST_REVIEW"],
    ["bloque", "BLOCK_STATUS"],
    ["formulario", "START_FORM"],
    ["form", "START_FORM"],
    ["llenar formulario", "START_FORM"],
    ["iniciar formulario", "START_FORM"],
    ["formulario web", "FORM_WEB"],
    ["form web", "FORM_WEB"],
    ["link formulario", "FORM_WEB"],
    ["web", "FORM_WEB"],
    ["form_web", "FORM_WEB"],
    ["ws", "FORM_WS"],
    ["whatsapp", "FORM_WS"],
    ["form_ws", "FORM_WS"],
    ["chat", "CHAT"],
    ["chatear", "CHAT"],
    ["hablar", "CHAT"],
    ["start_form", "START_FORM"],
    ["formularios", "FORM_LIST"],
    ["lista formularios", "FORM_LIST"],
    ["cambiar formulario", "FORM_LIST"],
    ["summary", "SUMMARY"],
    ["restart", "RESTART"],
    ["eliminar datos", "DELETE_DATA"],
    ["borrar datos", "DELETE_DATA"],
    ["olvida mis datos", "DELETE_DATA"],
    ["eliminar informacion", "DELETE_DATA"],
  ]);
  return map.get(normalized) || null;
}

export function isAffirmative(textRaw) {
  const t = (textRaw || "").trim().toLowerCase();
  const n = t.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return ["si", "sヴ", "acepto", "ok", "dale", "de acuerdo", "confirmo"].some((x) => n === x || n.startsWith(x + " "));
}
export function isNegative(textRaw) {
  const t = (textRaw || "").trim().toLowerCase();
  const n = t.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return ["no", "no acepto", "rechazo"].some((x) => n === x || n.startsWith(x + " "));
}
