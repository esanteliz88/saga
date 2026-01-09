import mongoose from "mongoose";

const OptionSchema = new mongoose.Schema({ label: String, value: mongoose.Schema.Types.Mixed }, { _id: false });
const ShowIfSchema = new mongoose.Schema({ qid: String, equals: mongoose.Schema.Types.Mixed }, { _id: false });
const QuestionSchema = new mongoose.Schema({
  qid: { type: String, required: true },
  label: { type: String, required: true },
  type: { type: String, required: true },
  required: { type: Boolean, default: false },
  description: String,
  blockId: { type: String, default: "default" },
  options: { type: [OptionSchema], default: undefined },
  showIf: { type: ShowIfSchema, default: undefined },
  meta: { type: Object, default: undefined },
}, { _id: false });

const FormTemplateSchema = new mongoose.Schema({
  code: { type: String, index: true },
  name: String,
  description: String,
  version: Number,
  isActive: { type: Boolean, default: true, index: true },
  questionGroups: { type: Array, default: undefined },
  blocks: { type: [{ id: String, name: String, description: String, meta: Object }], default: undefined },
  questions: { type: [QuestionSchema], default: [] },
  createdAt: Date,
  updatedAt: Date
}, { collection: "form_templates" });

export const FormTemplate = mongoose.model("FormTemplate", FormTemplateSchema);
