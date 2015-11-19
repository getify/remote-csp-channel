var net = require("net"),

	client = net.createConnection({ port: 8010 },onConnection),

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


// ************************

function onConnection() {
	RemoteCSPChannel.defineTransport(
		/*transportID=*/transport_id,
		/*transport=*/TransportNodeStream,

		// transport args:
		{ from: client, to: client }
	);

	ASQ().runner(
		ASQ.csp.go(function *main(){
			var ch = yield RemoteCSPChannel.openChannel(transport_id,channel_id);

			console.log("(" + channel_id + ") channel opened");

			var num = yield ASQ.csp.take(ch);

			console.log("(" + channel_id + ") message received:",num);
		})
	)
	.val(function(){
		client.end();
		console.log("socket connection complete");
	})
	.or(function(err){
		console.log(err);
	});
}
