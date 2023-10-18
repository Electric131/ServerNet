
function checkKey(event) {
    if (!event.repeat && SC.active) {
        SC.send({ key: event.key, type: event.type == "keydown" ? "press" : "release" });
    };
};

SC.waitForConnection(() => {
    document.onkeydown = checkKey;
    document.onkeyup = checkKey;
});

SC.appID = "keyboardTransmitter";
