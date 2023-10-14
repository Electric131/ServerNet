const express = require('express');
const { createServer } = require('http');
const WebSocket = require('ws');
const path = require('path');
const { RoomHandler, Host, Client } = require('./structures.js');

const wait = ms => new Promise(res => setTimeout(res, ms));
const app = express();
app.use(express.static(path.join(__dirname, '/public')));

var roomHandler = new RoomHandler();
app.post("/newRoom/", (req, res) => {
    console.log("new room requested");
    let room = roomHandler.newRoom();
    res.send({
        id: room.id,
        auth: room.auth,
        timeout: room.created + (room.timeout * 1000)
    });
});
app.all("*", (req, res) => {
    res.sendFile(path.join(__dirname, '/public/index.html'));
});

const server = createServer(app);
const wss = new WebSocket.Server({ server });

wss.on("connection", async function (ws, req) {
    let url = req.url.replace(/^\/room\//g, "");
    if (!url.match(/^\d+$/g) || !roomHandler.getRoom(parseInt(url))) {
        ws.send(JSON.stringify({ success: false, event: "connect", error: { msg: "Invalid room id", code: "invalidRoom" } }));
        ws.close();
        return;
    };
    // Tell client syntax as well as auto kick time if it doesn't provide connection information.
    ws.send(JSON.stringify({ event: "connect", info: "All messages will be in JSON syntax. Provide connection information to finalize connection.", autokick: Date.now() + 2000 }));
    let room = roomHandler.getRoom(parseInt(url));
    let connection = null;
    if (!room.host) {
        ws.send(JSON.stringify({ success: true, event: "join", role: "host", info: "Ready for authentication." }));
        connection = room.addConnection(new Host(ws, room));
        room.host = connection;
        room.state = "open";
    } else {
        if (room.state == "waiting") {
            ws.send(JSON.stringify({ success: false, event: "join", error: { msg: "Room hasn't been verified", code: "unverified" } }));
            return;
        };
        connection = room.addConnection(new Client(ws, room));
        ws.send(JSON.stringify({ success: true, event: "join", role: "client", info: "Ready for authentication." }));
    };
    if (!connection) { ws.send(JSON.stringify({ success: false, event: "join", error: { msg: "Connection failed for unknown reason", code: "unknownFailure" } })); ws.close(); return; };
    // ws.on('message', function (message) {
    //     try {
    //         var data = JSON.parse(message.toString());
    //         try {
    //             if (room.state == "waiting") { // Room is waiting authentication
    //                 // Requires 'auth' key
    //                 if (!data.auth) {
    //                     ws.send(JSON.stringify({ success: false, error: "'auth' required" }));
    //                     ws.close();
    //                     return;
    //                 };
    //                 if (data.auth == room.auth) {
    //                     ws.send(JSON.stringify({ success: true }));
    //                     room.host = room.addConnection(new Host(ws, room, data.appID || "default"));
    //                     room.state = "open";
    //                     console.log(room);
    //                 } else {
    //                     ws.send(JSON.stringify({ success: false, error: "Invalid auth" }));
    //                     ws.close();
    //                 };
    //             } else if (room.state == "open") {
    //                 room.addConnection(new Client(ws, room, data.appID || "default"));
    //                 console.log(room);
    //             };
    //         } catch (e) {
    //             console.error(e);
    //             ws.send(JSON.stringify({ success: false, error: "Unexpected backend error" }));
    //             ws.close();
    //         };
    //     } catch {
    //         ws.send(JSON.stringify({ success: false, error: "Expected JSON syntax" }));
    //         ws.close();
    //     };
    // });
});

server.listen(8080, function () {
    console.log('Listening on port 8080');
});
