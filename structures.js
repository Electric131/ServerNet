const uuid = require('uuid');

class Connection {
    constructor(ws, room, role) {
        this.ws = ws;
        this.room = room;
        this.role = role;
        this.data = {};
        this.state = "waiting";
        this.id = uuid.v4();

        this.ws.on("message", this.onmessage.bind(this));
        this.ws.on("open", this.onopen.bind(this));
        this.ws.on("close", this.onclose.bind(this));
        this.ws.on("close", function() { this.state = "closed"; });

        setTimeout(function() {
            if (this.state == "waiting") this.kill("Auth not provided in time", "authTimeout");
        }.bind(this), 2000);
    };

    setData(data) {
        if (!this.state == "waiting") return;
        this.data = data;
        this.state = "validating";
    };

    send(from = "system", data = {}) {
        this.ws.send(JSON.stringify({ from: from, data: data }));
    };

    kill(reason, code) {
        if (this.state == "killed") return;
        this.room.connections = this.room.connections.filter((connection) => connection !== this);
        this.state = "killed";
        this.send("system", { event: "kicked", reason: { msg: reason || "Unknown", code: code || "unknown" } });
        this.ws.close();
    };

    onopen() { };
    onclose() { };
    onmessage() { };
};

class Host extends Connection {
    constructor(ws, room) {
        super(ws, room, "host");
    };

    onmessage(msg) {
        msg = JSON.parse(msg.toString());
        if (this.state == "waiting") {
            if (msg.auth && msg.appID) {
                if (msg.auth == this.room.auth) { // Check if provided auth is the same as the room auth
                    this.ws.send(JSON.stringify({ success: true, event: "authenticate" }));
                    this.state = "authenticated";
                    this.room.state = "validated";
                    this.room.password = msg.password;
                    this.room.appID = msg.appID;
                    console.log("Host has verified room!");
                } else {
                    this.ws.send(JSON.stringify({ success: false, event: "authenticate", error: { msg: "Provided auth does not match room auth", code: "authMismatch" } }));
                };
            } else { // auth or appID was not sent
                this.ws.send(JSON.stringify({ success: false, event: "authenticate", error: { msg: "Either auth key or appID (or both) weren't provided", code: "missingRequired" } }));
            };
        };
    };

    onclose() {
        this.room.sendExcluding([this], "system", { event: "disconnect", target: "host" });
        this.room.close(); // Close due to host disconnect
    };
};

class Client extends Connection {
    constructor(ws, room) {
        super(ws, room, "client");
    };

    onmessage(msg) {
        msg = JSON.parse(msg.toString());
        if (this.state == "waiting") {
            if (msg.appID && msg.appID == this.room.appID && (!msg.password || !this.room.password || msg.password == this.room.password)) {
                this.state = "authenticated";
                this.ws.send(JSON.stringify({ success: true, event: "authenticate" }));
            } else if (!msg.appID || msg.appID != this.room.appID) {
                this.ws.send(JSON.stringify({ success: false, event: "authenticate", error: { msg: "appID doesn't match", code: "appIDMismatch" } }));
            } else if (this.room.password && (!msg.password || msg.password != this.room.password)) {
                this.ws.send(JSON.stringify({ success: false, event: "authenticate", error: { msg: "Password is incorrect", code: "invalidPassword" } }));
            } else {
                this.ws.send(JSON.stringify({ success: false, event: "authenticate", error: { msg: "Unexpected authentication fail", code: "authFailed" } }));
            };
        };
    };
};

class Room {
    constructor(handler, id, timeout = 5) {
        this.id = id;
        this.auth = uuid.v4();
        this.handler = handler;
        this.connections = [];
        this.state = "waiting";
        this.created = Date.now();
        this.timeout = timeout;
        this.host = null;
        this.password = null;
        this.appID = null;
        setTimeout(() => {
            if (this.state == "waiting") {
                this.handler.destroyRoom(this.id);
            };
        }, this.timeout * 1000);
    };

    send(from = "system", data = {}) {
        this.connections.forEach((connection) => {
            connection.send(from, data);
        });
    };

    sendExcluding(ignore, from = "system", data = {}) {
        this.connections.filter((val) => {return !ignore.includes(val)}).forEach((connection) => {
            connection.send(from, data);
        });
    };

    sendOnly(recievers, from = "system", data = {}) {
        recievers.forEach((connection) => {
            connection.send(from, data);
        });
    };

    addConnection(connection) {
        this.connections.push(connection);
        return connection;
    };

    close() {
        this.handler.destroyRoom(this.id);
    };
};

class RoomHandler {
    constructor() {
        this.rooms = [];
    };

    getIDs() {
        return this.rooms.map((value) => { return value.id; });
    };

    getRoom(id) {
        for (const room of this.rooms) {
            if (room.id == id) return room;
        }
        return null;
    };

    findRoom() {
        let highest = 1;
        this.getIDs().sort().forEach((val) => {
            if (val == highest) highest++;
        });
        return highest;
    };

    destroyRoom(id) {
        this.rooms = this.rooms.filter((value) => value.id != id);
    };

    closeRoom(id) {
        this.getRoom(id).send("system", { event: "disconnect", target: "host" });
    };

    newRoom() {
        let id = this.findRoom();
        let room = new Room(this, id);
        this.rooms.push(room);
        return room;
    };
};

module.exports = { Connection, Host, Client, Room, RoomHandler };
