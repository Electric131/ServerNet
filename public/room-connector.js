
class ServerClient {
    constructor() {
        this.roomID = null;
        this.ws = null;
        this.waitingConnections = [];
        this.appID = "default";
        this.processing = false;
    };

    connectionChange(success) {
        this.waitingConnections.forEach((val) => (success ? val.res : val.rej)());
    };

    waitForConnection() {
        return new Promise((res, rej) => {
            this.waitingConnections.push({ res, rej });
        });
    };

    connect(id, password) {
        return new Promise(async (res, rej) => {
            if (this.ws || this.processing) rej();
            this.processing = true;
            let ws = new WebSocket(`ws://localhost:8080/room/${id}`);
            ws.onmessage = function (msg) {
                let data = JSON.parse(msg.data);
                switch (data.event) {
                    case "join":
                        if (data.success && data.role == "client") {
                            ws.send(JSON.stringify({
                                appID: this.appID,
                                password: password
                            }));
                        } else {
                            this.processing = false;
                            return rej("Failed to connect to room");
                        };
                        break;
                    case "authenticate":
                        if (data.success) {
                            this.processing = false;
                            return res(ws);
                        } else {
                            this.processing = false;
                            return rej("Room authentication failed");
                        };
                        break;
                };
            }.bind(this);
        });
    };

    send(data) {
        if (!this.ws) return false;
        this.ws.send(JSON.stringify(data));
        return true;
    };
};


const SC = new ServerClient();

window.onload = function () {
    let connector = document.getElementById("connector");

    if (connector) {
        connector.style.display = "inline";
        var template = `<form><label for="scroomID">Room ID: </label><input type="text" id="scroomID"><br><label for="scroomPass">Room Password*: </label><input \
        type="password" id="scroomPass"></form>* Not always required<br><button id="sclogin">Login</button>\t<div id="sctext" style="display: inline"></div>`;
        connector.innerHTML = template;
        let loginButton = document.getElementById("sclogin");
        loginButton.onclick = function () {
            let text = document.getElementById("sctext");
            text.innerHTML = "";
            try {
                if (!(parseInt(document.getElementById("scroomID").value) > 0)) {
                    text.innerHTML = "Room ID must be a number greater than 0!";
                    return;
                };
                roomID = parseInt(document.getElementById("scroomID").value);
                SC.connect(roomID, document.getElementById("scroomPass").value)
                    .then(res => {
                        SC.roomID = SC.ws = res;
                        SC.connectionChange(true);
                    })
                    .catch(err => {
                        text.innerHTML = err;
                        return;
                    });
            } catch (e) {
                console.error(e);
                text.innerHTML = "An unknown error occurred!";
                return;
            };
        };
    };
};
