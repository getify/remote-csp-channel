var http = require("http"),
	server = http.createServer(router),
	io = require("socket.io")(server),
	spawn = require("child_process").spawn,

	ASQ = require("../../node_modules/asynquence"),
	RemoteCSPChannel = require("../../"),
	TransportSocketIO = require("../../transports/socketio"),
	TransportNodeStream = require("../../transports/nodestream"),

	transport_ids = {},
	channel_ids = {},

	transports_defined = {};

require("../../node_modules/asynquence-contrib/contrib-es6.src.js")(ASQ);

RemoteCSPChannel.initCSP(
	/*API=*/ASQ.csp,
	/*channelFactory=*/ASQ.csp.chan,
	/*returnAsPromise=*/function $$promisewrap(v){
		return (ASQ.isSequence(v) ? v : ASQ(v)).toPromise();
	}
);

server.listen(8005);

ASQ().runner(
	ASQ.csp.go(function *main(ch){
		spinUpServerSocket(ch.go);

		// keep alive (waiting for incoming socket requests)
		yield ASQ.csp.take(ch);
	})
)
.val(function(){
	console.log("server complete");
})
.or(function(err){
	console.log(err);
});


// *********************

function spinUpServerSocket(go) {
	io.of("/csp").on("connection",function onconn(CSPsocket){
		onCSPSocket(go,CSPsocket);

		for (var i=0; i<3; i++) {
			spinUpChildProcess(go);
		}
	});
}

function onCSPSocket(go,CSPsocket) {
	var params = parseUri(CSPsocket.handshake.url).queryKey,
		transport_id = decodeURIComponent(params.tr),
		channel_id = decodeURIComponent(params.ch),
		channel_ch = ASQ.csp.chan(),
		id = transport_id + ":" + channel_id;

	// if socket is disconnected, close the channel_ch
	CSPsocket.on("disconnect",function ondisc(){
		if (channel_ch) {
			channel_ch.close();
			channel_ch = null;
		}
	});

	if (!(id in transports_defined)) {
		RemoteCSPChannel.defineTransport(
			/*transportID=*/transport_id,
			/*transport=*/TransportSocketIO,

			// transport args:
			CSPsocket
		);

		transports_defined[id] = true;
	}

	RemoteCSPChannel.openChannel(transport_id,channel_id)
	.then(function chReady(ch){
		if (channel_ch) {
			ASQ.csp.putAsync(channel_ch,ch);
		}
	});

	go(cspProc,[ channel_ch, channel_id ] );
}

function spinUpChildProcess(go) {
	var transport_id = getNewTransportID("CPTR"),
		channel_id = getNewChannelID("CPCH"),
		child;

	child = spawn("node",[ "child-process.js", transport_id, channel_id ],{
		cwd: process.cwd(),
		env: process.env,
		stdio: [ "pipe", "pipe", process.stderr ]
	});

	RemoteCSPChannel.defineTransport(
		/*transportName=*/transport_id,
		/*transport=*/TransportNodeStream,

		// transport args:
		{ from: child.stdout, to: child.stdin }
	);

	go(remoteProc,[ transport_id, channel_id ]);
}

function *cspProc(_,channelCh,channelID) {
	var ch = yield ASQ.csp.take(channelCh);
	if (ch === ASQ.csp.CLOSED) {
		return;
	}
	channelCh.close();

	console.log("(" + channelID + ") channel opened");

	for (var i=0; i<1E9; i++) {}

	yield ASQ.csp.put(ch,i);

	console.log("(" + channelID + ") message sent");
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

function router(req,res) {
	res.writeHead(200,{ "Content-Type": "text/plain" });
	res.end("Nothing to see here.");
}

// adapted from: http://blog.stevenlevithan.com/archives/parseuri
function parseUri(r){for(var e={key:["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"],q:{name:"queryKey",parser:/(?:^|&)([^&=]*)=?([^&]*)/g},parser:{loose:/^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/}},o=e.parser.loose.exec(r),a={},s=14;s--;)a[e.key[s]]=o[s]||"";return a[e.q.name]={},a[e.key[12]].replace(e.q.parser,function(r,o,s){o&&(a[e.q.name][o]=s)}),a}
