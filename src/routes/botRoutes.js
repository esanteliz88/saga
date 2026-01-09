import { Router } from "express";
import { requireApiKey } from "../middlewares/auth.js";
import { handleBotMessage } from "../controllers/botController.js";
import { verifyToken, verifyMessage } from "../controllers/verifyController.js";


export const botRouter = Router();
botRouter.post("/message", requireApiKey, handleBotMessage);
botRouter.get("/verify", verifyToken);
botRouter.post("/verify", verifyMessage)
