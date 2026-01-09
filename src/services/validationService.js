const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const phoneRegex = /^\+?\d[\d\s()-]{7,}$/;

function normalizeText(text) { return String(text ?? "").trim(); }

function normalizeYesNo(text) {
  const t = normalizeText(text).toLowerCase();
  if (!t) return null;
  if (["si", "sí", "s", "yes", "y", "true", "1"].includes(t)) return "yes";
  if (["no", "n", "false", "0"].includes(t)) return "no";
  return null;
}

function coerceSelection(input, options = []) {
  const raw = normalizeText(input);
  const byLabel = options.find((o) => normalizeText(o.label).toLowerCase() === raw.toLowerCase());
  if (byLabel) return { value: byLabel.value, label: byLabel.label };
  const byValue = options.find((o) => String(o.value) === raw);
  if (byValue) return { value: byValue.value, label: byValue.label };
  const yn = normalizeYesNo(raw);
  if (yn) {
    const byYesNoLabel = options.find((o) => {
      const l = normalizeText(o.label).toLowerCase();
      if (yn === "yes") return ["si", "sí", "yes"].includes(l);
      return ["no"].includes(l);
    });
    if (byYesNoLabel) return { value: byYesNoLabel.value, label: byYesNoLabel.label };
    const byYesNoValue = options.find((o) => {
      const v = String(o.value).toLowerCase();
      if (yn === "yes") return ["1", "true", "si", "sí", "yes"].includes(v);
      return ["0", "false", "no"].includes(v);
    });
    if (byYesNoValue) return { value: byYesNoValue.value, label: byYesNoValue.label };
  }
  const idx = Number(raw);
  if (!Number.isNaN(idx) && idx >= 1 && idx <= options.length) {
    const opt = options[idx - 1];
    return { value: opt.value, label: opt.label };
  }
  return null;
}

export function validateAnswer(question, message) {
  const text = normalizeText(message?.text);
  const atts = message?.attachments || [];

  if (question.required && !text && atts.length === 0) return { ok: false, error: "required" };
  if (!text && atts.length > 0) return { ok: true, value: null, label: null, raw: null };

  switch (question.type) {
    case "dropdown":
    case "single_choice":
    case "select_one": {
      const sel = coerceSelection(text, question.options || []);
      if (!sel) return { ok: false, error: "invalid_option" };
      return { ok: true, value: sel.value, label: sel.label, raw: text };
    }
    case "date": {
      const iso = Date.parse(text);
      if (!Number.isNaN(iso)) return { ok: true, value: new Date(iso).toISOString().slice(0,10), label: null, raw: text };
      const m = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
      if (!m) return { ok: false, error: "invalid_date" };
      const dd = Number(m[1]); const mm = Number(m[2]); const yyyy = Number(m[3]);
      const d = new Date(Date.UTC(yyyy, mm - 1, dd));
      if (d.getUTCFullYear() !== yyyy || d.getUTCMonth() !== (mm - 1) || d.getUTCDate() !== dd) return { ok: false, error: "invalid_date" };
      return { ok: true, value: d.toISOString().slice(0,10), label: null, raw: text };
    }
    case "email":
      if (!emailRegex.test(text)) return { ok: false, error: "invalid_email" };
      return { ok: true, value: text, label: null, raw: text };
    case "phone":
      if (!phoneRegex.test(text)) return { ok: false, error: "invalid_phone" };
      return { ok: true, value: text, label: null, raw: text };
    case "name":
      if (text.length < 3) return { ok: false, error: "invalid_name" };
      return { ok: true, value: text, label: null, raw: text };
    case "text":
    default:
      if (question.qid === "q16") {
        const t = normalizeText(text).toLowerCase();
        if (t === "masculino" || t === "hombre") return { ok: true, value: "masculino", label: "Masculino", raw: text };
        return { ok: false, error: "invalid_option" };
      }
      if (question.required && text.length === 0) return { ok: false, error: "required" };
      return { ok: true, value: text, label: null, raw: text };
  }
}
