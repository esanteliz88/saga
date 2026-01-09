export function verifyToken(req, res) {
  console.log(req);

      return res.send("hola andres");

}


export function  verifyMessage (req, res) {
    try{
        console.log(req.body.entry[0].changes[0].value.messages[0])
        res.send("EVENT_RECEIVED");
    }catch(e){
        console.log(e);
        res.send("EVENT_RECEIVED");
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
