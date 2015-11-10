(function UMD(name,context,definition){
	if (typeof define === "function" && define.amd) { define(definition); }
	else if (typeof module !== "undefined" && module.exports) { module.exports = definition(); }
	else { context[name] = definition(name,context); }
})("TransportWebWorker",this,function DEF(name,namespaceContext){
	"use strict";

	var context,
		publicAPI = {
			connect: connect
		};

	return publicAPI;


	// *******************************

	function connect(workerObj) {
		var worker, msgHandler, send_queue = [], msg_target;

		if (typeof window == "undefined") {
			worker = true;

			// in shared worker?
			if ("onconnect" in self) {
				context = "shared-worker";
				self.addEventListener("connect",onConnect,false);
			}
			// assume regular worker
			else {
				context = "regular-worker";
				self.addEventListener("message",onStart,false);
			}
		}
		// assume main window
		else {
			context = "main";
			worker = workerObj;
			setup(worker,worker);
			sendMessage({ start: true, "msg-source": context });	// TODO: remove `msg-source`?
		}

		return {
			onMessage: defineMessageHandler,
			sendMessage: sendMessage
		};


		// *******************************

		function defineMessageHandler(handler) {
			msgHandler = handler;
		}

		function sendMessage(msg) {
			msg["msg-source"] = context;

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

			if (msgHandler) {
				msgHandler(msg);
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
