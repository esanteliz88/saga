export function renderConsentPrompt(name) {
  const who = name ? ` ${name}` : "";
  return {
    text:
      `Hola${who}. Gracias por escribirnos.\n` +
      `Antes de comenzar, necesito tu consentimiento para recopilar informacion de salud con fines de orientacion y derivacion clinica.\n\n` +
      `¿Aceptas continuar?`,
    buttons: [
      { label: "Si, acepto", value: "SI_ACEPTO" },
      { label: "No", value: "NO" }
    ],
  };
}

export function renderQuestion(question) {
  const header = question.label;
  const desc = question.description ? `\n_${question.description}_` : "";

  if (question.qid === "q16") {
    return {
      text: `${header}${desc}\n\nResponde con el texto de la opcion:`,
      buttons: [{ label: "Masculino", value: "masculino" }],
    };
  }

  if (question.type === "dropdown" || question.type === "single_choice" || question.type === "select_one") {
    const options = (question.options || []).map((o, idx) => `${idx + 1}) ${o.label}`).join("\n");
    return {
      text: `${header}${desc}\n\nResponde con el numero o el texto de la opcion:\n${options}`,
      buttons: (question.options || []).map((o) => ({ label: o.label, value: o.value })),
    };
  }

  if (question.type === "date") return { text: `${header}${desc}\n\nEjemplo: 31-12-1999`, buttons: [] };
  if (question.type === "email") return { text: `${header}${desc}\n\nEjemplo: nombre@correo.com`, buttons: [] };
  if (question.type === "phone") return { text: `${header}${desc}\n\nEjemplo: +56912345678`, buttons: [] };

  return { text: `${header}${desc}`, buttons: [] };
}

export function renderValidationError(question, error) {
  switch (error) {
    case "required":
      return { text: `Necesito una respuesta para continuar.\n\n${renderQuestion(question).text}`, buttons: renderQuestion(question).buttons || [] };
    case "invalid_option":
      {
        const opts = question.options || [];
        const example = opts.length ? `Ejemplo: 1 o "${opts[0].label}".` : `Ejemplo: escribe la opcion exacta.`;
        return { text: `Por favor elige una opcion valida.\n${example}\n\n${renderQuestion(question).text}`, buttons: renderQuestion(question).buttons || [] };
      }
    case "invalid_date":
      return { text: `La fecha no parece valida. Usa formato dd-mm-aaaa (ej: 31-12-1999).`, buttons: [] };
    case "invalid_email":
      return { text: `Ese email no parece valido. Ejemplo: nombre@correo.com`, buttons: [] };
    case "invalid_phone":
      return { text: `Ese telefono no parece valido. Ejemplo: +56912345678`, buttons: [] };
    case "invalid_name":
      return { text: `¿Me indicas tu nombre y apellido?`, buttons: [] };
    default:
      return { text: "No pude validar tu respuesta.", buttons: [] };
  }
}

export function buildSummaryText(session, form) {
  const byQid = new Map();
  for (const a of session.answers || []) byQid.set(a.qid, a);

  const lines = [];
  for (const q of form.questions || []) {
    if (!byQid.has(q.qid)) continue;
    const a = byQid.get(q.qid);
    const v = a.label ?? a.value;
    const evCount = (a.evidence || []).length;
    const ev = evCount ? ` (evidencias: ${evCount})` : "";
    lines.push(`- ${q.label}: ${v ?? "N/D"}${ev}`);
  }
  return lines.join("\n");
}

export function renderCompleted(form, summaryText) {
  const title = `Listo. Gracias. Completaste: ${form.name || form.code}`;
  const next = `Un profesional revisara tus respuestas. Si necesitas hablar con un humano, escribe "humano".`;
  const text = summaryText ? `${title}\n\n${summaryText}\n\n${next}` : `${title}\n\n${next}`;
  return { text, buttons: [] };
}

export function renderBlockIntro(block) {
  const header = block.name || block.id;
  const desc = block.description ? `\n${block.description}` : "";
  return { text: `Iniciemos el bloque: ${header}.${desc}`, buttons: [] };
}

export function renderBlockCompleted(block) {
  return { text: `Bloque ${block.name || block.id} completado.`, buttons: [] };
}
