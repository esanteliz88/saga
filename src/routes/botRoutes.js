import { Router } from "express";
import { handleBotMessage } from "../controllers/botController.js";
import { verifyToken, verifyMessage } from "../controllers/verifyController.js";


export const botRouter = Router();
botRouter.post("/message", handleBotMessage);
botRouter.get("/verify", verifyToken);
botRouter.post("/verify", verifyMessage)

// Simulate a WebSocket/WhatsApp incoming message for local testing
// Accepts payloads similar to what the WS delivers and adapts them
// to the internal `handleBotMessage` shape.
botRouter.post("/simulate-ws", (req, res) => {
	const body = req.body || {};

	// Example incoming WS shape:
	// {
	//   from: '56932281981',
	//   id: 'wamid....',
	//   timestamp: '1767981459',
	//   text: { body: 'Hola' },
	//   type: 'text'
	// }

	const transformed = {
		channel: body.channel || "whatsapp",
		user: {
			wa_id: body.from || (body.user && body.user.id) || body.wa_id || "",
			name: (body.user && body.user.name) || body.name || undefined
		},
		message: {
			id: body.id || (body.message && body.message.id) || undefined,
			text: (body.text && (body.text.body || body.text)) || (body.message && body.message.text) || "",
			type: body.type || (body.message && body.message.type) || "text",
			attachments: body.attachments || (body.message && body.message.attachments) || []
		},
		// allow optional formCode passthrough for testing
		formCode: body.formCode
	};

	req.body = transformed;
	return handleBotMessage(req, res);
});

// Simulate incoming Facebook/WhatsApp Graph payloads (Postman collection types)
botRouter.post("/simulate-fb", (req, res) => {
	const body = req.body || {};

	// Normalize common shapes from the Postman collection to our internal format
	const message = { id: undefined, text: "", type: "text", attachments: [] };

	const setText = (t) => {
		if (typeof t === "string") message.text = t;
		else if (t && typeof t.body === "string") message.text = t.body;
	};

	if (body.type === "text" || (body.text && (body.text.body || typeof body.text === "string"))) {
		setText(body.text || "");
		message.type = "text";
	} else if (body.type === "image" || body.image) {
		message.type = "image";
		const link = (body.image && (body.image.link || body.image)) || (body.image && body.image.url);
		if (link) message.attachments.push({ url: link });
	} else if (body.type === "audio" || body.audio) {
		message.type = "audio";
		const link = (body.audio && (body.audio.link || body.audio)) || (body.audio && body.audio.url);
		if (link) message.attachments.push({ url: link });
	} else if (body.type === "video" || body.video) {
		message.type = "video";
		const link = (body.video && (body.video.link || body.video)) || (body.video && body.video.url);
		if (link) message.attachments.push({ url: link });
	} else if (body.type === "document" || body.document) {
		message.type = "document";
		const link = (body.document && (body.document.link || body.document)) || (body.document && body.document.url);
		if (link) message.attachments.push({ url: link, filename: body.document && body.document.filename });
		if (body.document && body.document.caption) setText({ body: body.document.caption });
	} else if (body.type === "location" || body.location) {
		message.type = "location";
		const loc = body.location || {};
		message.text = `${loc.name || ""} ${loc.address || ""}`.trim();
		if (loc.latitude && loc.longitude) message.attachments.push({ url: `geo:${loc.latitude},${loc.longitude}` });
	} else if (body.type === "interactive" || body.interactive) {
		const interactive = body.interactive || {};
		// If this is a simulated incoming reply, Postman may include `interactive.reply` or we can accept a `selectedButtonId` param
		if (interactive.reply && (interactive.reply.title || interactive.reply.id)) {
			message.type = "text";
			message.text = interactive.reply.title || interactive.reply.id;
		} else if (body.selectedButtonId && interactive.action && Array.isArray(interactive.action.buttons)) {
			const found = interactive.action.buttons.find((b) => (b.reply && (b.reply.id === body.selectedButtonId || b.reply.title === body.selectedButtonId)) || b.id === body.selectedButtonId);
			if (found) message.text = (found.reply && (found.reply.title || found.reply.id)) || found.title || found.id;
		} else if (body.selectedRowId && interactive.action && Array.isArray(interactive.action.sections || [])) {
			const rows = (interactive.action.sections || []).flatMap((s) => s.rows || []);
			const found = rows.find((r) => r.id === body.selectedRowId || r.title === body.selectedRowId);
			if (found) message.text = found.title || found.id;
		} else if (interactive.type === "button" && interactive.action && Array.isArray(interactive.action.buttons)) {
			// default to first button title to simulate a press
			const b = interactive.action.buttons[0];
			message.text = (b && b.reply && (b.reply.title || b.reply.id)) || (b && b.title) || "";
		} else if (interactive.type === "list" && interactive.action && Array.isArray(interactive.action.sections || [])) {
			const rows = (interactive.action.sections || []).flatMap((s) => s.rows || []);
			const first = rows[0];
			message.text = first && (first.title || first.id) || "";
		}
	}

	const transformed = {
		channel: "whatsapp",
		user: { wa_id: body.to || body.to_contact || body.to_phone || body.to_number || body.to || body.recipient || body.to },
		message: {
			id: body.id || body.message_id || undefined,
			text: message.text,
			type: message.type,
			attachments: message.attachments
		},
		formCode: body.formCode
	};

	req.body = transformed;
	return handleBotMessage(req, res);
});
