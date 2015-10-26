(function UMD(name,context,definition){
	if (typeof define === "function" && define.amd) { define(definition); }
	else if (typeof module !== "undefined" && module.exports) { module.exports = definition(); }
	else { context[name] = definition(name,context); }
})("BridgeWebWorker",this,function DEF(name,context){
	"use strict";

	var remote_csp,
		orig_csp,
		publicAPI = {
			setup: setup,
			connect: connectBridge
		};

	return publicAPI;


	// *******************************

	function setup(remote,origCSP) {
		remote_csp = remote;
		orig_csp = origCSP;
		remote_csp.hijackCSP(origCSP);
	}

	function connectBridge(bridgeName,workerObj) {
		var worker, msg_target,
			send_queue = [], channels = {};

		remote_csp.defineBridge(bridgeName,{
			open: openChannel,
			close: closeChannel,
			signal: signalChannel
		});

		if (typeof window == "undefined") {
			worker = true;

			// in shared worker?
			if ("onconnect" in self) {
				self.addEventListener("connect",WWconnect,false);
			}
			// assume regular worker
			else {
				self.addEventListener("message",WWstart,false);
			}
		}
		// assume main window
		else {
			worker = workerObj;
			WWsetup(worker,worker);
			WWmessageTo({ start: true });
		}


		// *******************************

		function openChannel(channelID) {
			if (!(channelID in channels)) {
				WWmessageTo({
					"remote-connected": channelID
				});
				channels[channelID] = {};
				channels[channelID].pr = new Promise(function executor(resolve){
					channels[channelID].resolve = resolve;
				});
			}
			return channels[channelID].pr;
		}

		function closeChannel(channelID) {
			WWmessageTo({
				"remote-closed": channelID
			});
		}

		function signalChannel(channelID,cspMethod) {

		}

		function WWmessageTo(msg) {
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

		function WWmessageFrom(evt) {
			var action, channel_id, msg;

			try {
				msg = JSON.parse(evt.data);
			}
			catch (err) { return; }

			if (msg["remote-connected"] || msg["remote-closed"]) {
				action = msg["remote-connected"] ?
					"remote-connected" :
					"remote-closed";
				channel_id = msg[action];

				if (action == "remote-connected" &&
					channels[channel_id] &&
					channels[channel_id].resolve
				) {
					channels[channel_id].resolve();
					channels[channel_id].resolve = null;
				}
				else if (action == "remote-closed" &&
					channels[channel_id]
				) {
					// ..
				}
			}
			else if (msg["remote-signal"]) {
				channel_id = msg["channel"]
				// ..
			}
		}

		function WWsetup(source,target) {
			if (target) {
				msg_target = target;
				if (send_queue.length > 0) {
					send_queue.forEach(WWmessageTo);
					send_queue.length = 0;
				}
			}

			source.addEventListener("message",
				msg_target ? WWmessageFrom : waitForMsgTarget,
				false
			);

			function waitForMsgTarget(evt) {
				msg_target = evt.source;
				send_queue.forEach(WWmessageTo);
				send_queue.length = 0;

				source.removeEventListener("message",waitForMsgTarget,false);
				source.addEventListener("message",WWmessageFrom,false);

				WWmessageFrom(evt);
			}
		}

		function WWconnect(evt) {
			var port = evt.ports[0];
			WWsetup(port,port);
			port.start();
			self.removeEventListener("connect",WWconnect,false);
		}

		function WWstart(evt) {
			try {
				var msg = JSON.parse(evt.data);
			}
			catch (err) { return; }

			if (msg.start) {
				self.removeEventListener("message",WWstart,false);
				WWsetup(self,self);
			}
		}
	}

});
