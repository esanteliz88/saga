import mongoose from "mongoose";
import { logger } from "../utils/logger.js";

export async function connectDb() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "saga";
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { dbName });
  logger.info({ dbName }, "MongoDB connected");
}
