import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function loadEnv() {
  // Carga /home/azureuser/saga/.env (un nivel arriba de src)
  dotenv.config({ path: path.resolve(__dirname, "../../.env"), override: true });

  const required = ["MONGODB_URI", "MONGODB_DB", "API_KEY", "OPENAI_API_KEY"];
  const missing = required.filter((k) => !process.env[k] || String(process.env[k]).trim() === "");
  if (missing.length) console.warn(`[env] Faltan variables: ${missing.join(", ")} (revisa .env)`);

  const k = process.env.OPENAI_API_KEY || "";
  if (k) {
    const masked = `${k.slice(0, 6)}...${k.slice(-4)}`;
    logger.info({ msg: "OPENAI_API_KEY loaded", masked, length: k.length });
  } else {
    logger.warn({ msg: "OPENAI_API_KEY not set at startup" });
  }

  const sendEnabled = (process.env.FB_SEND_ENABLED || "false").toLowerCase() === "true";
  logger.info({
    msg: "FB_SEND_CONFIG",
    enabled: sendEnabled,
    phoneId: process.env.FB_PHONE_ID || process.env.FB_PHONE_NUMBER_ID ? "set" : "missing",
    token: process.env.FB_TOKEN || process.env.FB_AUTH_TOKEN || process.env.FB_BEARER_TOKEN ? "set" : "missing"
  });
}
