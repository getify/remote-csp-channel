(function UMD(name,context,definition){
	if (typeof define === "function" && define.amd) { define(definition); }
	else if (typeof module !== "undefined" && module.exports) { module.exports = definition(); }
	else { context[name] = definition(name,context); }
})("BridgeWebWorker",this,function DEF(name,context){
	"use strict";

	var remote_csp,
		orig_csp,
		bridge_context,
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
				bridge_context = "shared-worker";
				self.addEventListener("connect",WWconnect,false);
			}
			// assume regular worker
			else {
				bridge_context = "regular-worker";
				self.addEventListener("message",WWstart,false);
			}
		}
		// assume main window
		else {
			bridge_context = "browser";
			worker = workerObj;
			WWsetup(worker,worker);
			WWmessageTo({ start: true, "msg-source": bridge_context });
		}


		// *******************************

		function openChannel(ch) {
			var channel_id = ch.remote[1];

			// first time this channel-ID is trying to be opened?
			if (!channels[channel_id] || channels[channel_id].resolve) {
				// no local channel entry yet?
				if (!channels[channel_id]) {
					channels[channel_id] = channelPendingEntry({ ch: ch });
				}
				// otherwise, remote channel connection already received
				else {
					channels[channel_id].ch = ch;
					channels[channel_id].resolve(ch);
					channels[channel_id].resolve = channels[channel_id].reject = null;
				}

				WWmessageTo({
					"remote-connected": channel_id,
					"msg-source": bridge_context
				});
			}

			return channels[channel_id].pr;
		}

		function closeChannel(channelID) {
			WWmessageTo({
				"remote-closed": channelID
			});
		}

		function signalChannel(channelID,cspMethod) {
			WWmessageTo({
				"remote-signal": channelID,
				"method": cspMethod,
				"args": [].slice.call(arguments,2)
			});
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
			var action, channel_id, msg, args;

			try {
				msg = JSON.parse(evt.data);
			}
			catch (err) { return; }

			if (("remote-connected" in msg) || ("remote-closed" in msg)) {
				action = ("remote-connected" in msg) ?
					"remote-connected" :
					"remote-closed";
				channel_id = msg[action];

				// remote channel connection signal?
				if (action == "remote-connected") {
					// local channel entry not yet defined?
					if (!channels[channel_id]) {
						channels[channel_id] = channelPendingEntry({});
					}
					// local channel still pending on remote open?
					else if (channels[channel_id].resolve) {
						channels[channel_id].resolve(channels[channel_id].ch);
						channels[channel_id].resolve = channels[channel_id].reject = null;
					}
					// otherwise, ignore connection message on already
					// opened channel
				}
				// remote channel close signal received?
				else if (action == "remote-closed" &&
					channels[channel_id]
				) {
					// local channel to close?
					if (channels[channel_id].ch) {
						channels[channel_id].ch.origClose();
					}
					// local channel still pending?
					else if (channels[channel_id].reject) {
						channels[channel_id].reject();
					}

					// cleanup
					channels[channel_id].resolve = channels[channel_id].reject = null;
				}
			}
			else if (msg["remote-signal"]) {
				channel_id = msg["remote-signal"];

				// recognized local CSP method?
				if (orig_csp[msg["method"]]) {
					// add `ch` to list of args
					args = [channels[channel_id].ch].concat(msg["args"]);

					// invoke the original (non-wrapped) CSP method
					orig_csp[msg["method"]].apply(null,args);
				}
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


			// *******************************

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

	function channelPendingEntry(chan) {
		chan.pr = new Promise(function executor(resolve,reject){
			chan.resolve = resolve;
			chan.reject = reject;
		});
		return chan;
	}

});
