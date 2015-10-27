(function UMD(name,context,definition){
	if (typeof define === "function" && define.amd) { define(definition); }
	else if (typeof module !== "undefined" && module.exports) { module.exports = definition(); }
	else { context[name] = definition(name,context); }
})("BridgeWebWorker",this,function DEF(name,context){
	"use strict";

	var remote_csp,
		orig_csp,
		bridge_context,
		wrap_return,
		publicAPI = {
			setup: setup,
			connect: connectBridge
		};

	return publicAPI;


	// *******************************

	function setup(remote,origCSP,wrapReturn) {
		remote_csp = remote;
		orig_csp = origCSP;
		remote_csp.hijackCSP(origCSP);
		wrap_return = wrapReturn || function $$promisewrap(v) { return Promise.resolve(v); };
	}

	function connectBridge(bridgeName,workerObj) {
		var worker, msg_target, send_queue = [],
			channels = {}, message_ids = {};

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
			WWmessageTo({ start: true, "msg-source": bridge_context });	// TODO: remove `msg-source`?
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
					"msg-source": bridge_context		// TODO: remove `msg-source`?
				});
			}

			if (!ch.pending_messages) {
				ch.pending_messages = {};
			}

			return channels[channel_id].pr;
		}

		function closeChannel(channelID) {
			WWmessageTo({
				"remote-closed": channelID
			});
		}

		function signalChannel(channelID,cspMethod) {
			var inOut = /^put/.test(cspMethod) ? "out" : "in",
				ch = channels[channelID].ch,
				args = [].slice.call(arguments,2),
				entry, id, pr, pr2, ack;

			// found a matching (aka, opposite) entry?
			entry = findOppositePendingMessageEntry(ch,inOut);
			if (entry) {
				id = entry.in || entry.out;

				// local entry?
				if (message_ids[id]) {
					// cancel the previous remote pending message
					WWmessageTo({
						"remote-message-cancel": channelID,
						"id": id
					});

					// find and remove this entry from the queue
					findPendingMessageEntry(ch,id,/*remove=*/true);

					// fake entry state as if remote signaling had completed
					entry.ack = id;
					entry[inOut] = getNewMessageID(inOut + ":" + bridge_context);

					// redo previously remoted action as local instead
					pr = wrap_return(orig_csp[entry.out_msg.method].apply(null,entry.out_msg.args));

					// perform current CSP action as local
					pr2 = wrap_return(orig_csp[cspMethod].apply(null,args));

					// compose both local csp actions together
					pr2
						.then(
							function onFulfilled(){ return pr; },
							function onRejected(){ return pr; }
						)
						.then(entry.resolve,entry.reject)
						.then(cleanupEntry,cleanupEntry);

					return pr2;
				}
				// otherwise, prepare ACK to send back to remote
				else {
					ack = id;
				}
			}

			// make a new local entry
			entry = makePendingMessageEntry(ch,inOut);
			id = entry.in || entry.out;

			entry.out_msg = {
				"remote-message": channelID,
				"id": id,
				"method": cspMethod,
				"args": args
			};

			if (ack) {
				msg.ack = ack;
			}

			WWmessageTo(entry.out_msg);

			return entry.pr;


			// *******************************

			function cleanupEntry() {
				killMessageEntry(entry);
			}
		}

		function killMessageEntry(entry) {
			delete message_ids[entry.in];
			delete message_ids[entry.out];
			entry.resolve = entry.reject = entry.pr = entry.out_msg =
				entry.ack = entry.in = entry.out = null;
		}

		function findPendingMessageEntry(ch,msgID,remove) {
			var inOut = /(in|out):/.match(msgID)[1], entry;

			for (var i=0; i<ch.pending_messages.length; i++) {
				if (ch.pending_messages[i][inOut] == msgID) {
					entry = ch.pending_messages[i];
					if (remove) {
						ch.pending_messages.splice(i,1);
					}
					return entry;
				}
			}
		}

		function findOppositePendingMessageEntry(ch,inOut) {
			for (var i=0; i<ch.pending_messages.length; i++) {
				if (!ch.pending_messages[i][inOut]) {
					return ch.pending_messages[i];
				}
			}
		}

		function getNewMessageID(prefix) {
			do { var id = prefix + ":" + Math.random(); }
			while (id in message_ids);
			message_ids[id] = true;
		}

		function makePendingMessageEntry(ch,inOut) {
			var id = getNewMessageID(inOut + ":" + bridge_context);

			var entry = { in: null, out: null };
			entry[inOut] = id;
			entry.pr = new Promise(function executor(resolve,reject){
				entry.resolve = resolve;
				entry.reject = reject;
			});
			ch.pending_messages.push(entry);

			return entry;
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
			var action, channel_id, msg, args, entry, pr;

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
			else if (msg["remote-message"]) {
				channel_id = msg["remote-message"];

				// recognized local CSP method?
				if (orig_csp[msg["method"]]) {
					// add `ch` to list of args
					args = [channels[channel_id].ch].concat(msg["args"]);

					// invoke the original (non-wrapped) CSP method
					pr = wrap_return(orig_csp[msg["method"]].apply(null,args));

					// TODO:
					// 1. check for opposite matching entry
					// 2. resolve and send ack if so
					// 3. check for and handle 'ack' in msg
				}
			}
			else if (msg["remote-message-ack"]) {
				channel_id = msg["remote-message-ack"];

				// TODO: find matching entry, resolve promise if
				// in/out/ack are all present
			}
			else if (msg["remote-message-cancel"]) {
				channel_id = msg["remote-message-cancel"];
				if (channels[channel_id].ch) {
					entry = findPendingMessageEntry(
						channels[channel_id].ch,
						msg["id"],
						/*remove=*/true
					);
					killMessageEntry(entry);

					// TODO: remove the local channel's queue action!
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
