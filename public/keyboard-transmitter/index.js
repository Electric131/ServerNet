
SC.waitForConnection().then(() => {
    SC.send({key: "w"});
}).catch(console.error);

SC.appID = "keyboardTransmitter";
