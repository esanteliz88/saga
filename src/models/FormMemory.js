import mongoose from "mongoose";

const AttachmentSchema = new mongoose.Schema({ url: String, mime: String, filename: String, size: Number }, { _id: false });
const EventSchema = new mongoose.Schema({
  direction: { type: String, enum: ["IN","OUT"], required: true },
  messageId: String,
  type: String,
  text: String,
  attachments: { type: [AttachmentSchema], default: undefined },
  agent: { type: String, enum: ["PRIMARY","MEDIC","NURSE","SPECIALIST","SYSTEM"], default: "PRIMARY" },
  ts: { type: Date, default: () => new Date() }
}, { _id: false });

const FormMemorySchema = new mongoose.Schema({
  wa_id: { type: String, index: true },
  formCode: { type: String, index: true },
  events: { type: [EventSchema], default: [] },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
  deleteRequestedAt: Date,
  deletePurgeAt: Date,
  deletedAt: Date
}, { collection: "form_memory" });

FormMemorySchema.index({ wa_id: 1, formCode: 1 }, { unique: true });

export const FormMemory = mongoose.model("FormMemory", FormMemorySchema);
