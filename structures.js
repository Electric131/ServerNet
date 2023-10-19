const uuid = require('uuid');

class Connection {
    constructor(ws, room, role) {
        this.ws = ws;
        this.room = room;
        this.role = role;
        this.data = {};
        this.state = "waiting";
        this.id = uuid.v4(); // Generate a unique id for this connection

        // Bucket for handling rate limiting
        this.maxBucketCount = 20; // Max msgs to be sent in the given timeframe (at most)
        this.bucketTimeframe = 100; // Rate at which bucket regenerates
        this.bucketCount = this.maxBucketCount; // Regerates bucket every x ms; dictated by bucketTimeFrame
        // Bucket warns will increase every time connection is rate limited
        // and will reset every 5s - Connection is kicked if this hits 3
        this.bucketWarns = 0;

        // Websocket bindings
        this.ws.on("message", this.internalMessage.bind(this));
        this.ws.on("open", this.onopen.bind(this));
        this.ws.on("close", this.onclose.bind(this));
        this.ws.on("close", function() { this.state = "closed"; });

        setInterval(function() { if (this.bucketCount < this.maxBucketCount) this.bucketCount++ }.bind(this), this.bucketTimeframe);
        setInterval(function() { this.bucketWarns = 0 }.bind(this), 5000);
    };

    internalMessage(msg) { // Handle checking JSON syntax of message
        if (this.bucketCount <= 0) {
            if (this.bucketWarns >= 2) {
                return this.kill("Rate limit exceeded", "rateExceeded");
            };
            this.bucketWarns++;
            return this.ws.send(JSON.stringify({ success: false, event: "unknown", error: { msg: "Rate limit reached", code: "rateLimited" } }));
        };
        this.bucketCount--;
        try {
            let newMsg = JSON.parse(msg.toString());
            this.onmessage(newMsg);
        } catch {
            this.kill("Failed to parse message as JSON", "invalidJSON");
        };
    };

    setData(data) {
        if (!this.state == "waiting") return;
        this.data = data;
        this.state = "validating";
    };

    send(from="system", data={}, id=null) {
        if (this.state == "killed" || this.state == "closed") return;
        if (id) {
            this.ws.send(JSON.stringify({ from: from, id: id, data: data }));
        } else {
            this.ws.send(JSON.stringify({ from: from, data: data }));
        };
    };

    kill(reason, code) {
        if (this.state == "killed") return;
        this.room.connections = this.room.connections.filter((connection) => connection !== this);
        this.state = "killed";
        this.send("system", { event: "disconnected", reason: { msg: reason || "Unknown", code: code || "unknown" } });
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
        if (this.state == "waiting") {
            if (msg.auth && msg.appID) {
                if (msg.auth == this.room.auth) { // Check if provided auth is the same as the room auth
                    this.ws.send(JSON.stringify({ success: true, event: "authenticate" }));
                    this.state = "authenticated";
                    this.room.state = "validated";
                    this.room.password = msg.password;
                    this.room.appID = msg.appID;
                    console.log(`Room #${this.room.id} validated.`);
                } else {
                    this.ws.send(JSON.stringify({ success: false, event: "authenticate", error: { msg: "Provided auth does not match room auth", code: "authMismatch" } }));
                };
            } else { // auth or appID was not sent
                this.ws.send(JSON.stringify({ success: false, event: "authenticate", error: { msg: "Either auth key or appID (or both) weren't provided", code: "missingRequired" } }));
            };
        } else if (this.state == "authenticated") {
            if (msg.to) {
                switch (msg.to) {
                    case "system":
                        switch (msg.data.action) {
                            case "kick":
                                let connection = this.room.findConnection(msg.data.id);
                                if (connection) {
                                    this.ws.send(JSON.stringify({ success: true, event: "message" }));
                                    connection.kill("Kicked by host", "hostKick");
                                } else {
                                    this.ws.send(JSON.stringify({ success: false, event: "message", error: { msg: "Invalid client", code: "invalidClient" } }));
                                };
                                break;
                            default:
                                this.ws.send(JSON.stringify({ success: false, event: "message", error: { msg: "Invalid action", code: "invalidAction" } }));
                        };
                        break;
                    default:
                        let connection = this.room.findConnection(msg.to);
                        console.log(msg.to, connection);
                        if (msg.to && connection) {
                            this.ws.send(JSON.stringify({ success: true, event: "message" }));
                            connection.send("host", msg.data);
                        } else {
                            this.ws.send(JSON.stringify({ success: false, event: "message", error: { msg: "Invalid client", code: "invalidClient" } }));
                        };
                };
            } else {
                this.ws.send(JSON.stringify({ success: false, event: "message", error: { msg: "Missing 'to' key (should be 'system' or a client id)", code: "missingReciever" } }));
            };
        };
    };

    onclose() {
        this.room.close("Host disconnected", "hostDisconnect"); // Close due to host disconnect
    };
};

class Client extends Connection {
    constructor(ws, room) {
        super(ws, room, "client");
    };

    onmessage(msg) {
        if (this.state == "waiting") {
            let validAppID = msg.appID && msg.appID == this.room.appID;
            let validPassword = !this.room.password || (msg.password && this.room.password) && msg.password == this.room.password;
            if (validAppID && validPassword) {
                this.state = "authenticated";
                this.room.host.send("system", { event: "join", id: this.id });
                this.ws.send(JSON.stringify({ success: true, event: "authenticate" }));
            } else if (!validAppID) {
                this.ws.send(JSON.stringify({ success: false, event: "authenticate", error: { msg: "appID doesn't match", code: "appIDMismatch" } }));
            } else if (!validPassword) {
                this.ws.send(JSON.stringify({ success: false, event: "authenticate", error: { msg: "Password is incorrect", code: "invalidPassword" } }));
            } else {
                this.ws.send(JSON.stringify({ success: false, event: "authenticate", error: { msg: "Unexpected authentication fail", code: "authFailed" } }));
            };
        } else {
            this.room.host.send("client", msg, this.id);
        };
    };

    onclose() {
        if (this.state != "waiting") {
            this.room.host.send("system", { event: "disconnect", id: this.id });
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
        this.connections.filter((val) => { return !ignore.includes(val) }).forEach((connection) => {
            connection.send(from, data);
        });
    };

    sendOnly(recievers, from = "system", data = {}) {
        recievers.forEach((connection) => {
            connection.send(from, data);
        });
    };

    findConnection(id) {
        let found = this.connections.filter((connection) => { return connection.id == id });
        if (found.length != 1) {
            return null; // Either none or too many connections were found
        };
        return found[0];
    };

    addConnection(connection) {
        this.connections.push(connection);
        return connection;
    };

    close(reason, code) {
        console.log(`Room #${this.id} closed: ${code}.`);
        this.connections.forEach((val) => { val.kill(reason, code); });
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
