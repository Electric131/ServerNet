const express = require('express');
const fileUpload = require("express-fileupload");
const sanitize = require("sanitize-filename");
const { createServer } = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { RoomHandler, Host, Client } = require('./structures.js');

const wait = ms => new Promise(res => setTimeout(res, ms));
const app = express();
app.use(express.static(path.join(__dirname, '/public')));
app.use(fileUpload());

function renderPage(path, vars = {}) {
    return new Promise((res, rej) => {
        fs.readFile(path, 'utf8', (err, data) => {
            if (err) { console.log(err); return; };
            let matches = data.matchAll(/\${{(\S+)}}/gm);
            for (const match of matches) {
                data = data.replace(`$\{{${match[1]}}\}`, vars[match[1]]);
            }
            res(data);
        });
    });
};

if (fs.existsSync("./public/file-transfer/downloaded-files")) {
    fs.rm("./public/file-transfer/downloaded-files", { recursive: true }, e => { fs.mkdirSync("./public/file-transfer/downloaded-files"); });
} else {
    fs.mkdirSync("./public/file-transfer/downloaded-files");
};

var tempfiles = {};
app.all("/file-transfer/uploadfile", (req, res) => {
    let success = false;
    if (req.method == "POST") {
        if (req.files && req.files.filename) {
            try {
                let name = req.files.filename.name;
                name = sanitize(name.replaceAll(" ", "-")); // Sanitize file name
                let path = "./public/file-transfer/downloaded-files/" + name;
                req.files.filename.mv(path).then(file => { });
                tempfiles[name] = new Date().getTime() + 60000 * 0.1;
                setTimeout(function (filepath, name) {
                    if (fs.existsSync(filepath)) { // Precaution to ensure file does exist still
                        fs.unlink(filepath, err => { });
                    };
                    delete tempfiles[name];
                }, 60000 * 0.1, path, name);
                success = true;
                res.redirect("/file-transfer/upload/?state=success&filename=" + encodeURIComponent(name));
            } catch {};
        };
        // res.download() for downloads after
    };
    if (!success) {
        res.redirect("/file-transfer/upload/?state=fail");
    };
})
app.get("/file-transfer/upload", (req, res) => {
    if (req.query && req.query.state) {
        if (req.query.state == "success" && req.query.filename) {
            renderPage('./file-transfer/upload.html', { header: `File Uploaded Successfully!`, info: `Uploaded as "${req.query.filename}"\nView at: <a href="/file-transfer/uploads/${req.query.filename}">${req.query.filename}</a>` }).then(data => {
                res.send(data);
            });
        } else {
            renderPage('./file-transfer/upload.html', { header: `File Upload Failed.`, info: `` }).then(data => {
                res.send(data);
            });
        }
        return;
    }
    renderPage('./file-transfer/upload.html', { header: ``, info: `` }).then(data => {
        res.send(data);
    });
});
app.get("/file-transfer/downloaded-files/*", (req, res) => {
    if (fs.existsSync('./public' + req.url)) {
        res.sendFile(path.join(__dirname, '/public' + req.url));
    } else {
        res.redirect("/file-transfer/uploads");
    };
});
app.get("/file-transfer/uploads", (req, res) => {
    let fileList = ["None"];
    if (Object.keys(tempfiles).length > 0) {
        fileList = [];
        let time = new Date().getTime();
        for (const filename of Object.keys(tempfiles)) {
            if (tempfiles[filename] <= time) continue;
            fileList.push(`<a href="/file-transfer/uploads/${filename}">${filename}</a>`);
        }
    }
    renderPage('./file-transfer/uploads.html', { fileList: fileList.join("<br>") }).then(data => {
        res.send(data);
    });
    return;
});
app.get("/file-transfer/uploads/*", (req, res) => {
    let file = req.url.replace(/^\/file-transfer\/uploads\//, "");
    if (fs.existsSync("./public/file-transfer/downloaded-files/" + file)) {
        renderPage('./file-transfer/view-file.html', { finalTime: tempfiles[file], filename: file }).then(data => {
            res.send(data);
        });
    } else {
        res.redirect("/file-transfer/uploads");
    };
    return;
});

var roomHandler = new RoomHandler();
app.post("/newRoom/", (req, res) => {
    let room = roomHandler.newRoom();
    console.log(`Room #${room.id} opened.`);
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
    ws.send(JSON.stringify({ success: true, event: "connect", info: "All messages will be in JSON syntax. Provide connection information to finalize connection.", autokick: Date.now() + 2000 }));
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
});

server.listen(8080, function () {
    console.log('Listening on port 8080');
});
