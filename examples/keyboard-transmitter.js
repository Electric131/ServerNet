import('node-fetch');
const { WebSocket } = require('ws');

fetch(`http://localhost:8080/newRoom`, {
    method: "POST",
    headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
}).then((response) => {
    response.json().then((data) => {
        let ws = new WebSocket(`ws://localhost:8080/room/${data.id}`);
        ws.on('message', function (msg) {
            msg = JSON.parse(msg.toString());
            console.log(msg);
            switch (msg.event) {
                case "join": // Joined server and ready to auth
                    if (msg.success) {
                        if (msg.role == "host") {
                            ws.send(JSON.stringify({
                                auth: data.auth,
                                appID: "keyboardTransmitter"
                            }));
                        } else {
                            console.log("Couldn't join as host.");
                            ws.close();
                        };
                    };
            };
        });
    }).catch(console.error);
}).catch(console.error);