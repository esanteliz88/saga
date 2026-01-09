export function verifyToken(req, res) {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    const expected = process.env.FB_VERIFY_TOKEN || process.env.VERIFY_TOKEN || "";

    if (mode === "subscribe" && token && expected && token === expected) {
        return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
}


import { handleBotMessage } from "./botController.js";
import { sendWhatsAppMessage } from "../services/fbService.js";

export async function verifyMessage(req, res) {
    try {
        const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        console.log(msg || req.body);

        if (!msg) {
            // Nothing to process
            return res.send("EVENT_RECEIVED");
        }

        // Build internal payload expected by handleBotMessage
        const text = GetTextUser(msg) || (msg.text && msg.text.body) || "";
        const attachments = [];
        if (msg.image && (msg.image.link || msg.image.url)) attachments.push({ url: msg.image.link || msg.image.url });
        if (msg.document && (msg.document.link || msg.document.url)) attachments.push({ url: msg.document.link || msg.document.url, filename: msg.document.filename });
        if (msg.video && (msg.video.link || msg.video.url)) attachments.push({ url: msg.video.link || msg.video.url });
        if (msg.audio && (msg.audio.link || msg.audio.url)) attachments.push({ url: msg.audio.link || msg.audio.url });

        const transformed = {
            channel: "whatsapp",
            user: { wa_id: msg.from || msg.from_number || msg.sender || "" },
            message: {
                id: msg.id || msg.message_id,
                text,
                type: msg.type || (msg.text ? "text" : "unknown"),
                attachments
            },
            formCode: undefined
        };

        // If caller requests the reply (WS proxy), capture handleBotMessage output and return it.
        const wantReply = req.query?.returnReply === "true" || req.headers["x-return-reply"] === "1" || req.headers["x-return-reply"] === "true";

        const fakeReq = { body: transformed };

        if (wantReply) {
            // Capture response body from handleBotMessage
            let captured = null;
            const fakeRes = {
                json: (obj) => { captured = obj; },
                status: (_code) => ({ json: (obj) => { captured = obj; } }),
                send: (v) => { captured = typeof v === "string" ? { text: v } : v; }
            };
            try {
                await handleBotMessage(fakeReq, fakeRes);
            } catch (e) {
                console.error("handleBotMessage error:", e);
            }
            // If we captured something, return it; otherwise still reply EVENT_RECEIVED
            if (captured) return res.json(captured);
            return res.send("EVENT_RECEIVED");
        }

        // Default: dispatch asynchronously and return EVENT_RECEIVED immediately (Facebook webhook behavior)
        try {
            const dummyRes = {
                json: (obj) => obj,
                status: (_code) => ({ json: (obj) => obj }),
                send: (v) => (typeof v === "string" ? { text: v } : v)
            };
            setImmediate(async () => {
                try {
                    let captured = null;
                    const captureRes = {
                        json: (obj) => { captured = obj; },
                        status: (_code) => ({ json: (obj) => { captured = obj; } }),
                        send: (v) => { captured = typeof v === "string" ? { text: v } : v; }
                    };

                    await handleBotMessage(fakeReq, captureRes);

                    const reply = captured?.reply || captured || {};
                    const text =
                        reply.text ||
                        reply.message?.text ||
                        reply.reply?.text ||
                        null;

                    if (text) {
                        const event = reply.buttons && reply.buttons.length
                            ? { type: "interactive", text, buttons: reply.buttons }
                            : { type: "text", text };
                        await sendWhatsAppMessage(transformed.user.wa_id, event);
                    }
                } catch (e) {
                    console.error("handleBotMessage error:", e);
                }
            });
        } catch (e) {
            console.error("Failed to dispatch to handleBotMessage", e);
        }

        return res.send("EVENT_RECEIVED");
    } catch (e) {
        console.log(e);
        return res.send("EVENT_RECEIVED");
    }
}

function GetTextUser(messages){
    var text = "";
    var typeMessge = messages["type"];
    if(typeMessge == "text"){
        text = (messages["text"])["body"];
    }
    else if(typeMessge == "interactive"){

        var interactiveObject = messages["interactive"];
        var typeInteractive = interactiveObject["type"];
        
        if(typeInteractive == "button_reply"){
            text = (interactiveObject["button_reply"])["title"];
        }
        else if(typeInteractive == "list_reply"){
            text = (interactiveObject["list_reply"])["title"];
        }else{
            console.log("sin mensaje");
        }
    }else{
        console.log("sin mensaje");
    }
    return text;
}
