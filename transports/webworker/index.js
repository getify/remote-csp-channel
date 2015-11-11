(function UMD(name,context,definition){
	if (typeof define === "function" && define.amd) { define(definition); }
	else if (typeof module !== "undefined" && module.exports) { module.exports = definition(); }
	else { context[name] = definition(name,context); }
})("TransportWebWorker",this,function DEF(name,namespaceContext){
	"use strict";

	var connection_defined = false,
		connect_evt,
		start_evt,
		message_evts = [],
		context = "main",

		publicAPI = {
			connect: connect
		};

	saveEvents();

	return publicAPI;


	// *******************************

	function saveEvents() {
		if (typeof window == "undefined") {
			// in shared worker?
			if ("onconnect" in self) {
				context = "shared-worker";
				self.addEventListener("connect",saveConnect,false);
			}
			// assume regular worker
			else {
				context = "dedicated-worker";
				self.addEventListener("message",saveMessages,false);
			}
		}
	}

	function saveConnect(evt) {
		connect_evt = evt;
	}

	function saveMessages(evt) {
		message_evts.push(evt);
	}

	function connect(workerObj) {
		var connect_context = context, msg_handler,
			send_queue = [], msg_target;

		// on initial connection?
		if (!connection_defined) {
			connection_defined = true;

			if (connect_context == "shared-worker") {
				self.removeEventListener("connect",saveConnect,false);
				if (connect_evt) {
					onConnect(connect_evt);
				}
			}
			else if (connect_context == "dedicated-worker") {
				self.removeEventListener("message",saveMessages,false);
				if (message_evts.length > 0) {
					start_evt = message_evts.shift();
					onStart(start_evt);
				}
			}
		}

		if (workerObj) {
			if (connect_context != "main") {
				connect_context += "-main";
			}
			setup(workerObj,workerObj);
			sendMessage({ start: true });
		}
		else if (connect_context == "shared-worker") {
			if (!connect_evt) {
				self.addEventListener("connect",onConnect,false);
			}
			connect_evt = null;
		}
		else if (connect_context == "dedicated-worker") {
			if (!start_evt) {
				self.addEventListener("message",onStart,false);
			}
			start_evt = null;
		}

		return {
			onMessage: defineMessageHandler,
			sendMessage: sendMessage
		};


		// *******************************

		function defineMessageHandler(handler) {
			if (!msg_handler) {
				msg_handler = handler;

				if (message_evts.length > 0) {
					message_evts.forEach(onMessage);
				}
				message_evts.length = 0;
			}
			else {
				msg_handler = handler;
			}
		}

		function sendMessage(msg) {
			msg["msg-source"] = connect_context;

			if (!msg_target) {
				send_queue.push(msg);
			}
			else {
				if (typeof msg != "string") {
					msg = JSON.stringify(msg);
				}

				msg_target.postMessage(msg);
			}
		}

		function onMessage(evt) {
			var msg;

			try {
				msg = JSON.parse(evt.data);
			}
			catch (err) { return; }

			if (msg_handler) {
				msg_handler(msg);
			}
		}

		function setup(source,target) {
			if (target) {
				msg_target = target;
				if (send_queue.length > 0) {
					send_queue.forEach(sendMessage);
					send_queue.length = 0;
				}
			}

			source.addEventListener("message",
				msg_target ? onMessage : waitForMsgTarget,
				false
			);


			// *******************************

			function waitForMsgTarget(evt) {
				source.removeEventListener("message",waitForMsgTarget,false);
				source.addEventListener("message",onMessage,false);

				msg_target = evt.source;
				send_queue.forEach(sendMessage);
				send_queue.length = 0;

				onMessage(evt);
			}
		}

		function onConnect(evt) {
			self.removeEventListener("connect",onConnect,false);

			var port = evt.ports[0];
			setup(port,port);
			port.start();
		}

		function onStart(evt) {
			try {
				var msg = JSON.parse(evt.data);
			}
			catch (err) { return; }

			if (msg.start) {
				self.removeEventListener("message",onStart,false);
				setup(self,self);
			}
		}
	}

});
