import('node-fetch');
const { WebSocket } = require('ws');
const robot = require('robotjs');

var clients = {};

function formatKey(key, mapping=null) {
    let replacements = {
        arrowup: "up",
        arrowdown: "down",
        arrowleft: "left",
        arrowright: "right",
        " ": "space"
    };
    if (mapping) return mapping[replacements[key] || key] || key;
    return replacements[key] || key;
};

var keys = {
    LETTERS: "qwertyuiopasdfghjklzxcvbnm".split(""),
    NUMS: "0123456789".split(""),
    SYMBOLS: "`~-_=+[{]}\\|;:'\",<.>/?".split(""),
    NSYMBOLS: "!@#$%^&*()".split(""),
    ARROWS: ["up", "down", "left", "right"],
    WASD: "wasd".split(""),
    SPECIAL: ["backspace", "delete", "enter", "tab", "escape", "home", "end", "pageup", "pagedown", "command", "alt", "shift"],
    SPACE: ["space"]
};

keys.ALPHANUMERIC = keys.LETTERS.concat(keys.NUMS);

var maxClients = 1;

var mappings = [
    {
        "w": "i",
        "a": "j",
        "s": "k",
        "d": "l",
        "space": "pageup",
        "shift": "pagedown"
    }
];

var allowedKeys = [
    // keys.LETTERS.concat(["enter", "space", "shift", "backspace", "tab"]).concat(keys.NUMS).concat(keys.SYMBOLS).concat(keys.ARROWS).concat(keys.NSYMBOLS)
    keys.ARROWS.concat(keys.SPACE).concat(["enter"])
];

var types = ["press", "release"];

fetch(`https://${process.env.URL}/newRoom`, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
}).then((response) => {
    response.json().then((data) => {
        let ws = new WebSocket(`wss://${process.env.URL}/room/${data.id}`);
        ws.on('message', function (msg) {
            msg = JSON.parse(msg.toString());
            if (!msg.from) {
                switch (msg.event) {
                    case "join": // Joined server and ready to auth
                        if (msg.success) {
                            if (msg.role == "host") {
                                ws.send(JSON.stringify({
                                    auth: data.auth,
                                    appID: "keyboardTransmitter",
                                    password: "cookies"
                                }));
                            } else {
                                console.log("Couldn't join as host.");
                                ws.close();
                            };
                        };
                };
            } else {
                switch (msg.from) {
                    case "system":
                        switch (msg.data.event) {
                            case "join":
                                let clientCount = Object.keys(clients).length;
                                if (clientCount >= maxClients) {
                                    ws.send(JSON.stringify({ to: "system", data: { action: "kick", id: msg.data.id } }))
                                    return;
                                };
                                clients[msg.data.id] = { keys: allowedKeys[clientCount], mapping: mappings[clientCount], held: [] };
                                break;
                            case "disconnect":
                                console.log("Client disconnected! If this is because they left on their own (not kicked), this could cause problems with mappings!");
                                if (!clients[msg.data.id]) return;
                                clients[msg.data.id].held.forEach((val) => {
                                    robot.keyToggle(formatKey(val, clients[msg.data.id].mappings), "up");
                                });
                                delete clients[msg.data.id];
                                break;
                        };
                    case "client":
                        if (!clients[msg.id]) return;
                        if (msg.data.key && clients[msg.id].keys.includes(formatKey(msg.data.key.toLowerCase())) && msg.data.type && types.includes(msg.data.type)) {
                            if (!clients[msg.id].held.includes(msg.data.key.toLowerCase()) && msg.data.type != "release") {
                                clients[msg.id].held.push(msg.data.key.toLowerCase());
                                robot.keyToggle(formatKey(msg.data.key.toLowerCase(), clients[msg.id].mappings), "down");
                            } else {
                                clients[msg.id].held = clients[msg.id].held.filter((val) => { return val != msg.data.key.toLowerCase() });
                                robot.keyToggle(formatKey(msg.data.key.toLowerCase(), clients[msg.id].mappings), "up");
                            };
                        };
                        break;
                };
            };
        });
    }).catch(console.error);
}).catch(console.error);