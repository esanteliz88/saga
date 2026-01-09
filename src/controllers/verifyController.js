export function verifyToken(req, res) {
  console.log(req);

      return res.send("hola andres");

}


import { handleBotMessage } from "./botController.js";

export function verifyMessage(req, res) {
    try {
        const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        console.log(msg || req.body);

        if (msg) {
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

            // Call handleBotMessage asynchronously but respond to Facebook immediately
            try {
                const fakeReq = { body: transformed };
                const dummyRes = { json: () => {}, status: () => ({ json: () => {} }), send: () => {} };
                setImmediate(() => {
                    try {
                        // handleBotMessage is async; call and ignore result
                        // eslint-disable-next-line no-void
                        void handleBotMessage(fakeReq, dummyRes);
                    } catch (e) {
                        console.error("handleBotMessage error:", e);
                    }
                });
            } catch (e) {
                console.error("Failed to dispatch to handleBotMessage", e);
            }
        }

        // Facebook expects a quick 200 with body EVENT_RECEIVED
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
