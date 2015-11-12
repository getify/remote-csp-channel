(function UMD(name,context,definition){
	if (typeof define === "function" && define.amd) { define(definition); }
	else if (typeof module !== "undefined" && module.exports) { module.exports = definition(); }
	else { context[name] = definition(name,context); }
})("TransportSocketIO",this,function DEF(name,namespaceContext){
	"use strict";

	var context = "main",

		publicAPI = {
			connect: connect
		};

	return publicAPI;


	// *******************************

	function connect(socket) {
		var msg_handler;

		socket.on("message",onMessage);

		return {
			onMessage: defineMessageHandler,
			sendMessage: sendMessage
		};


		// *******************************

		function defineMessageHandler(handler) {
			msg_handler = handler;
		}

		function sendMessage(msg) {
			msg["msg-source"] = context;
			socket.emit("message",msg);
		}

		function onMessage(msg) {
			if (msg_handler) {
				msg_handler(msg);
			}
		}
	}

});
