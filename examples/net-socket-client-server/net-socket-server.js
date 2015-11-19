var net = require("net"),

	server = net.createServer(onConnection),

	ASQ = require("../../node_modules/asynquence"),
	RemoteCSPChannel = require("../../"),
	TransportNodeStream = require("../../transports/nodestream"),

	transport_id = "netsocket",
	channel_id = "123";

require("../../node_modules/asynquence-contrib/contrib-es6.src.js")(ASQ);

RemoteCSPChannel.initCSP(
	/*API=*/ASQ.csp,
	/*channelFactory=*/ASQ.csp.chan,
	/*returnAsPromise=*/function $$promisewrap(v){
		return (ASQ.isSequence(v) ? v : ASQ(v)).toPromise();
	}
);

server.listen(8010);


// **************************

function onConnection(conn) {
	RemoteCSPChannel.defineTransport(
		/*transportID=*/transport_id,
		/*transport=*/TransportNodeStream,

		// transport args:
		{ from: conn, to: conn }
	);

	ASQ().runner(
		ASQ.csp.go(function *main(){
			var ch = yield RemoteCSPChannel.openChannel(transport_id,channel_id);

			console.log("(" + channel_id + ") channel opened");

			for (var i=0; i<1E9; i++) {}

			yield ASQ.csp.put(ch,i);

			console.log("(" + channel_id + ") message sent");
		})
	)
	.val(function(){
		server.close();
		console.log("socket connection complete");
	})
	.or(function(err){
		server.close();
		console.log(err);
	});
}
