(function(){
	"use strict";

	var transport_ids = {},
		channel_ids = {},
		transport_id = getNewTransportID("FIB"),
		channel_id = getNewChannelID("CH"),

		CSPsocket = io(
			"http://localhost:8005/csp?" +
			"tr=" + transport_id +
			"&ch=" + channel_id
		);

	RemoteCSPChannel.initCSP(
		/*API=*/ASQ.csp,
		/*channelFactory=*/ASQ.csp.chan,
		/*returnAsPromise=*/function $$promisewrap(v){
			return (ASQ.isSequence(v) ? v : ASQ(v)).toPromise();
		}
	);

	RemoteCSPChannel.defineTransport(
		/*transportID=*/transport_id,
		/*transport=*/TransportSocketIO,

		// transport args:
		CSPsocket
	);

	ASQ().runner( ASQ.csp.go(getFib) );


	// ****************************

	function *getFib() {
		// open remote channel
		var ch = yield RemoteCSPChannel.openChannel(
			transport_id,
			channel_id
		);

		// ask server for FIB(42)
		yield ASQ.csp.put(ch,42);

		// wait for answer
		var fib = yield ASQ.csp.take(ch);

		// show answer
		document.getElementById("answer").innerHTML = fib;
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
