import mongoose from "mongoose";

const EvidenceSchema = new mongoose.Schema({ url: String, mime: String, filename: String, size: Number, ts: { type: Date, default: () => new Date() } }, { _id: false });
const AnswerSchema = new mongoose.Schema({
  qid: { type: String, required: true },
  value: mongoose.Schema.Types.Mixed,
  label: String,
  raw: mongoose.Schema.Types.Mixed,
  ts: { type: Date, default: () => new Date() },
  evidence: { type: [EvidenceSchema], default: undefined },
  verification: { status: { type: String, enum: ["PENDING","PASSED","FAILED"], default: "PENDING" }, reason: String, attempts: { type: Number, default: 0 } }
}, { _id: false });

const BlockStatusSchema = new mongoose.Schema({
  blockId: { type: String, required: true },
  status: { type: String, enum: ["PENDING","IN_PROGRESS","DONE","NEEDS_REVIEW"], default: "PENDING" },
  attempts: { type: Number, default: 0 },
  pendingAction: { type: Object, default: undefined }
}, { _id: false });

const FormSessionSchema = new mongoose.Schema({
  wa_id: { type: String, index: true },
  name: String,
  channel: String,
  formCode: { type: String, index: true },
  status: { type: String, enum: ["AWAITING_CONSENT","IN_PROGRESS","COMPLETED","HANDOFF","CANCELLED","PENDING_REVIEW","AWAITING_EXTERNAL"], default: "AWAITING_CONSENT", index: true },
  currentQid: String,
  currentBlockId: String,
  consentPrompted: { type: Boolean, default: false },
  notes: { type: Object, default: {} },
  deleteRequestedAt: Date,
  deletePurgeAt: Date,
  deletedAt: Date,
  answers: { type: [AnswerSchema], default: [] },
  blockStatuses: { type: [BlockStatusSchema], default: [] },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() }
}, { collection: "form_sessions" });

FormSessionSchema.index({ wa_id: 1, formCode: 1 }, { unique: true });

export const FormSession = mongoose.model("FormSession", FormSessionSchema);
