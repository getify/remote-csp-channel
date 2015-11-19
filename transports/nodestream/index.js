(function UMD(name,context,definition){
	if (typeof define === "function" && define.amd) { define(definition); }
	else if (typeof module !== "undefined" && module.exports) { module.exports = definition(); }
	else { context[name] = definition(name,context); }
})("TransportNodeStream",this,function DEF(name,namespaceContext){
	"use strict";

	var context = "main",
		MESSAGE_DELIMITER = "\n^\n^\n^\n",
		MESSAGE_DELIMITER_RE = /\n\^\n\^\n\^\n/,

		publicAPI = {
			connect: connect
		};

	return publicAPI;


	// *******************************

	function connect(iostreams) {
		var msg_handler;

		iostreams.from.on("data",onMessage);

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
			msg = JSON.stringify(msg);
			iostreams.to.write(msg + MESSAGE_DELIMITER);
		}

		function onMessage(buf) {
			var msg = buf.toString(),
				msgs = msg.split(MESSAGE_DELIMITER_RE);

			for (var i=0; i<msgs.length; i++) {
				if (msgs[i] &&
					!MESSAGE_DELIMITER_RE.test(msgs[i]) ||
					/^\s+$/.test(msgs[i])
				) {
					msg = msgs[i];

					try {
						msg = JSON.parse(msg);
					}
					catch (err) { return; }

					if (msg_handler) {
						msg_handler(msg);
					}
				}
			}
		}
	}
});
