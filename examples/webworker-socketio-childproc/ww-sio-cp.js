(function(){
	"use strict";

	var transport_ids = {},
		channel_ids = {};

	RemoteCSPChannel.initCSP(
		/*API=*/ASQ.csp,
		/*channelFactory=*/ASQ.csp.chan,
		/*returnAsPromise=*/function $$promisewrap(v){
			return (ASQ.isSequence(v) ? v : ASQ(v)).toPromise();
		}
	);

	ASQ().runner(
		ASQ.csp.go(function *main(ch){
			for (var i=0; i<1; i++) {
				spinUpWorkerProcess(ch.go);
			}

			spinUpServerProcess(ch.go);
		})
	)
	.val(function(){
		console.log("local complete");
	});


	// ****************************

	function spinUpWorkerProcess(go) {
		var transport_id = getNewTransportID("WWTR"),
			channel_id = getNewChannelID("WWCH");

		RemoteCSPChannel.defineTransport(
			/*transportID=*/transport_id,
			/*transport=*/TransportWebWorker,

			// transport args:
			new Worker("worker-process.js#tr=" + transport_id + "&ch=" + channel_id)
		);

		go(remoteProc,[ transport_id, channel_id ]);
	}

	function spinUpServerProcess(go) {
		var transport_id = getNewTransportID("SIOTR"),
			channel_id = getNewChannelID("SIOCH"),

			CSPsocket = io(
				"http://localhost:8005/csp?" +
				"tr=" + transport_id +
				"&ch=" + channel_id
			);

		RemoteCSPChannel.defineTransport(
			/*transportID=*/transport_id,
			/*transport=*/TransportSocketIO,

			// transport args:
			CSPsocket
		);

		go(remoteProc,[ transport_id, channel_id ]);
	}

	function *remoteProc(_,transportID,channelID) {
		var ch = yield RemoteCSPChannel.openChannel(transportID,channelID);
		console.log("(" + channelID + ") channel opened");

		var num = yield ASQ.csp.take(ch);
		console.log("(" + channelID + ") message received:",num);
	}

	function getNewTransportID(prefix) {
		do { var id = prefix + ":" + Math.round(Math.random() * 1E9); }
		while (id in transport_ids);
		transport_ids[id] = true;
		return id;
	}

	function getNewChannelID(prefix) {
		do { var id = prefix + ":" + Math.round(Math.random() * 1E9); }
		while (id in channel_ids);
		channel_ids[id] = true;
		return id;
	}

})();
