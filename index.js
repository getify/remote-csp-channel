(function UMD(name,context,definition){
	if (typeof define === "function" && define.amd) { define(definition); }
	else if (typeof module !== "undefined" && module.exports) { module.exports = definition(); }
	else { context[name] = definition(name,context); }
})("RemoteCSPChannel",this,function DEF(name,namespaceContext){
	"use strict";

	var transports = {},
		channel_transport = {},
		message_ids = {},
		pre_channel_queue = {},
		wrap_csp_return,
		channel_factory,
		orig_csp,
		rejected_pr = Promise.reject(),
		publicAPI = {
			initCSP: initCSP,
			defineTransport: defineTransport,
			openChannel: openChannel
		};


	// opting out of false "unhandled rejection" warnings
	rejected_pr.catch(function noop(){});

	return publicAPI;


	// ***************************

	function defaultPromiseWrap(v) {
		return Promise.resolve(v);
	}

	function defaultChannelFactory() {
		if (namespaceContext &&
			typeof namespaceContext.chan !== "undefined"
		) {
			return namespaceContext.chan.apply(null,arguments);
		}

		throw "Missing default channel factory method";
	}

	function initCSP(CSP,channelFactory,wrapCSPReturn) {
		channel_factory = channelFactory || defaultChannelFactory;
		wrap_csp_return = wrapCSPReturn || defaultPromiseWrap;

		// save existing API methods
		orig_csp = {
			take: CSP.take,
			put: CSP.put,
			alts: CSP.alts,
			takem: CSP.takem,
			takeAsync: CSP.takeAsync,
			takemAsync: CSP.takemAsync,
			putAsync: CSP.putAsync,
			altsAsync: CSP.altsAsync
		};

		// hijack CSP API with wrapped methods
		Object.keys(orig_csp).forEach(function eacher(key){
			CSP[key] = makeCSPMethodWrapper(key,orig_csp);
		});


		// ***************************

		function makeCSPMethodWrapper(methodName,orig) {
			return function $$wrapper(ch) {
				var args = [].slice.call(arguments);

				if (
					(methodName == "alts" || methodName == "altsAsync") &&
					Array.isArray(ch)
				) {
					for (var i=0; i<ch.length; i++) {
						if (ch[i].remote) {
							ch = ch[i];
							break;
						}
					}
				}

				if (ch.remote && transports[ch.remote[0]]) {
					args.unshift(
						/*transportName=*/ch.remote[0],
						/*channelID=*/ch.remote[1],
						/*cspMethod=*/methodName
					);
					return signalChannel.apply(null,args);
				}
				else {
					return orig[methodName].apply(null,args);
				}
			};
		}
	}

	function defineTransport(transportName,transport) {
		if (transports[transportName]) {
			throw "Transport '" + transportName + "' already defined";
		}

		var args = [].slice.call(arguments,2),
			adapter = transport.connect.apply(null,args);

		transports[transportName] = {
			channels: {},
			sendMessage: adapter.sendMessage
		};

		adapter.onMessage(onMessage);
	}

	function openChannel(transportName,channelID) {
		var pr, ch, args = [].slice.call(arguments,2);

		if (transports[transportName]) {
			channel_transport[channelID] = transportName;
			ch = getChannel.apply(null,args);
			ch.remote = [transportName,channelID];
			pr = connectChannel(ch);
		}

		return (pr || rejected_pr);


		// ***************************

		function getChannel() {
			var ch = channel_factory.apply(null,arguments);

			// save original close() method
			ch.origClose = ch.close;

			// wrap close method: also signal remote close
			ch.close = function $$close() {
				closeChannel(transportName,channelID);
				ch.origClose();
			};

			return ch;
		}
	}

	function connectChannel(ch) {
		var msg, transport_name = ch.remote[0],
			channel_id = ch.remote[1],
			chan_entry = transports[transport_name].channels[channel_id];

		// first time this channel-ID is trying to be opened?
		if (!chan_entry || chan_entry.resolve) {
			// no local channel entry yet?
			if (!chan_entry) {
				chan_entry = transports[transport_name].channels[channel_id] =
					channelPendingEntry({ ch: ch });
			}
			// otherwise, remote channel connection already received
			else {
				chan_entry.ch = ch;
				chan_entry.resolve(ch);
				chan_entry.resolve = chan_entry.reject = null;
			}

			messageTo(transport_name,{
				"remote-connected": channel_id
			});

			if (pre_channel_queue[channel_id]) {
				while ((msg = pre_channel_queue[channel_id].shift())) {
					onMessage(msg);
				}
				delete pre_channel_queue[channel_id];
			}
		}

		if (!ch.pending_messages) {
			ch.pending_messages = [];
		}

		return chan_entry.pr;
	}

	function closeChannel(transportName,channelID) {
		messageTo(transportName,{
			"remote-closed": channelID
		});
	}

	function signalChannel(transportName,channelID,cspMethod) {
		var in_out = /^put/.test(cspMethod) ? "out" : "in",
			ch = transports[transportName].channels[channelID].ch,
			args = [].slice.call(arguments,3), args2,
			msg_entry, id, pr, pr2, ack, msg;

		// found a matching (aka, opposite) entry?
		msg_entry = findOppositePendingMessageEntry(ch,in_out);
		if (msg_entry) {
			id = msg_entry.in || msg_entry.out;

			// local entry?
			if (message_ids[id]) {
				// cancel the previous remote pending message
				messageTo(transportName,{
					"remote-action-cancel": channelID,
					"id": id
				});

				// find and remove this entry from the queue
				findPendingMessageEntry(ch,id,/*remove=*/true);

				// fake entry state as if remote signaling had completed
				msg_entry[in_out] = getNewMessageID(in_out + ":" + transport_name);

				args2 = [ch].concat(msg_entry.waiting_for_ack.args);

				// redo previously remoted action as local instead
				pr = wrap_csp_return(orig_csp[msg_entry.waiting_for_ack.method].apply(null,args2));

				// perform current CSP action as local
				pr2 = wrap_csp_return(orig_csp[cspMethod].apply(null,args));

				// compose both local csp actions together
				pr2
					.then(
						function onFulfilled(){ return pr; },
						function onRejected(){ return pr; }
					)
					.then(msg_entry.resolve,msg_entry.reject)
					.then(cleanupEntry,cleanupEntry);

				return pr2;
			}
			// otherwise, prepare ACK to send back to remote
			else {
				ack = id;
			}
		}

		if (!msg_entry) {
			// make a new (pending) local entry
			msg_entry = makePendingMessageEntry(ch,in_out);
			id = msg_entry.in || msg_entry.out;
		}
		else {
			// add local id to previous entry
			id = getNewMessageID(in_out + ":" + transportName);
			msg_entry[in_out] = id;
			addPromiseToEntry(msg_entry);
		}

		// CSP method with channel as single first param
		if (/^(?:put|take)/.test(cspMethod)) {
			args.shift();
		}
		else {
			// TODO: filter out channels from alts(..) / altsAsync(..) args
		}

		msg = {
			"remote-action": channelID,
			"id": id,
			"method": cspMethod,
			"args": args
		};

		// send ack along with message
		if (ack) {
			msg.ack = ack;
		}

		messageTo(transportName,msg);

		msg_entry.waiting_for_ack = msg;

		return msg_entry.pr;


		// *******************************

		function cleanupEntry() {
			clearMessageEntry(msg_entry);
		}
	}

	function clearMessageEntry(msgEntry) {
		delete message_ids[msgEntry.in];
		delete message_ids[msgEntry.out];
		msgEntry.resolve = msgEntry.reject = msgEntry.pr = msgEntry.waiting_for_ack =
			msgEntry.ack = msgEntry.in = msgEntry.out = null;
	}

	function findPendingMessageEntry(ch,msgID,remove) {
		var in_out = msgID.match(/^(in|out):/)[1], msg_entry;

		for (var i=0; i<ch.pending_messages.length; i++) {
			if (ch.pending_messages[i][in_out] == msgID) {
				msg_entry = ch.pending_messages[i];
				if (remove) {
					ch.pending_messages.splice(i,1);
				}
				return msg_entry;
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
		return id;
	}

	function makePendingMessageEntry(ch,inOut) {
		var transport_name = ch.remote[0],
			id = getNewMessageID(inOut + ":" + transport_name);

		var msg_entry = { in: null, out: null };
		msg_entry[inOut] = id;
		addPromiseToEntry(msg_entry);
		ch.pending_messages.push(msg_entry);

		return msg_entry;
	}

	function addPromiseToEntry(msgEntry) {
		msgEntry.pr = new Promise(function executor(resolve,reject){
			msgEntry.resolve = resolve;
			msgEntry.reject = reject;
		});
	}

	function messageTo(transportName,msg) {
		transports[transportName].sendMessage(msg);
	}

	function onMessage(msg) {
		var action, channel_id, args, msg_entry, in_out,
			transport_name, chan_entry;

		if (("remote-connected" in msg) || ("remote-closed" in msg)) {
			action = ("remote-connected" in msg) ?
				"remote-connected" :
				"remote-closed";
			channel_id = msg[action];

			// transport+channel opened locally?
			if (channel_transport[channel_id]) {
				transport_name = channel_transport[channel_id];
				chan_entry = transports[transport_name].channels[channel_id];

				// remote channel connection signal?
				if (action == "remote-connected") {
					// local channel entry not yet defined?
					if (!chan_entry) {
						chan_entry = transports[transport_name].channels[channel_id] =
							channelPendingEntry({});
					}
					// local channel still pending on remote open?
					else if (chan_entry.resolve) {
						chan_entry.resolve(chan_entry.ch);
						chan_entry.resolve = chan_entry.reject = null;
					}
					// otherwise, ignore connection message on already
					// opened channel
				}
				// remote channel close signal received?
				else if (action == "remote-closed" &&
					chan_entry
				) {
					// local channel to close?
					if (chan_entry.ch) {
						chan_entry.ch.origClose();
					}
					// local channel still pending?
					else if (chan_entry.reject) {
						chan_entry.reject();
					}

					// cleanup
					chan_entry.resolve = chan_entry.reject = null;
				}
			}
			// defer message while transport+channel is not yet open
			else {
				pre_channel_queue[channel_id] = pre_channel_queue[channel_id] || [];
				pre_channel_queue[channel_id].push(msg);
			}
		}
		else if (msg["remote-action"]) {
			channel_id = msg["remote-action"];
			transport_name = channel_transport[channel_id];
			chan_entry = transports[transport_name].channels[channel_id];

			// recognized local CSP method?
			if (orig_csp[msg.method]) {
				// check for opposite matching entry to attach to
				in_out = msg.id.match(/^(in|out):/)[1];
				msg_entry = findOppositePendingMessageEntry(chan_entry.ch,in_out);
				if (msg_entry) {
					// add remote msg id
					msg_entry[in_out] = msg.id;

					// send ack
					messageTo(transport_name,{
						"remote-action-ack": channel_id,
						id: msg.id
					});

					// ack bundled in with message, and entry now complete?
					if (msg.ack && msg_entry.in && msg_entry.out) {
						// remove the entry
						msg_entry = findPendingMessageEntry(
							chan_entry.ch,
							msg.ack,
							/*remove=*/true
						);

						// double check that we actually found/removed the entry?
						if (msg_entry) {
							// add channel to list of args
							args = [
								chan_entry.ch
							].concat(msg_entry.waiting_for_ack.args);

							// run CSP action for now-ack'd local msg
							wrap_csp_return(
								orig_csp[msg_entry.waiting_for_ack.method].apply(null,args)
							)
							.then(msg_entry.resolve,msg_entry.reject);

							clearMessageEntry(msg_entry);
						}
					}
				}
				// no entry found, so make one to wait for local action
				else {
					msg_entry = { in: null, out: null };
					msg_entry[in_out] = msg.id;
					chan_entry.ch.pending_messages.push(msg_entry);
				}

				// add channel to list of args
				args = [
					chan_entry.ch
				].concat(msg.args);

				// run CSP action from remote msg
				orig_csp[msg.method].apply(null,args);
			}
		}
		else if (msg["remote-action-ack"]) {
			channel_id = msg["remote-action-ack"];
			transport_name = channel_transport[channel_id];
			chan_entry = transports[transport_name].channels[channel_id];

			msg_entry = findPendingMessageEntry(
				chan_entry.ch,
				msg.id
			);

			// entry complete now that is has ack and both in/out id's?
			if (msg_entry.in && msg_entry.out) {
				// remove the entry
				msg_entry = findPendingMessageEntry(
					chan_entry.ch,
					msg.id,
					/*remove=*/true
				);

				// add channel to list of args
				args = [
					chan_entry.ch
				].concat(msg_entry.waiting_for_ack.args);

				// run CSP action for now-ack'd local msg
				wrap_csp_return(
					orig_csp[msg_entry.waiting_for_ack.method].apply(null,args)
				)
				.then(msg_entry.resolve,msg_entry.reject);

				clearMessageEntry(msg_entry);
			}
		}
		else if (msg["remote-action-cancel"]) {
			channel_id = msg["remote-action-cancel"];
			transport_name = channel_transport[channel_id];
			chan_entry = transports[transport_name].channels[channel_id];

			if (chan_entry.ch) {
				msg_entry = findPendingMessageEntry(
					chan_entry.ch,
					msg["id"],
					/*remove=*/true
				);
				clearMessageEntry(msg_entry);

				// TODO: remove the local channel's queue action!
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
