var ASQ = require("../../node_modules/asynquence"),
	RemoteCSPChannel = require("../../"),
	TransportNodeStream = require("../../transports/nodestream"),

	fs = require("fs");

require("../../node_modules/asynquence-contrib/contrib-es6.src.js")(ASQ);

RemoteCSPChannel.initCSP(
	/*API=*/ASQ.csp,
	/*channelFactory=*/ASQ.csp.chan,
	/*returnAsPromise=*/function $$promisewrap(v){
		return (ASQ.isSequence(v) ? v : ASQ(v)).toPromise();
	}
);


ASQ().runner( ASQ.csp.go(childProc) );


// ***********************

function *childProc(){
	var transport_id = process.argv[2] || "CPTR",
		channel_id = process.argv[3] || "CPCH";

	RemoteCSPChannel.defineTransport(
		/*transportName=*/transport_id,
		/*transport=*/TransportNodeStream,

		// transport args:
		{ from: process.stdin, to: process.stdout }
	);

	var ch = yield RemoteCSPChannel.openChannel(transport_id,channel_id);

	outputLog("(" + channel_id + ") channel opened");

	//console.log("(" + channel_id + ") channel opened");

	for (var i=0; i<1E9; i++) {}

	yield ASQ.csp.put(ch,i);

	outputLog("(" + channel_id + ") message sent");

	//console.log("(" + channel_id + ") message sent");
}

function outputLog(msg) {
	// var file = fs.openSync("output.txt","a");
	// fs.writeSync(file,msg + "\n");
	// fs.closeSync(file);
}
