var http = require("http"),
	server = http.createServer(router),
	io = require("../../node_modules/socket.io")(server),

	ASQ = require("../../node_modules/asynquence"),
	RemoteCSPChannel = require("../../"),
	TransportSocketIO = require("../../transports/socketio"),

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
			/*transportName=*/transport_id,
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

	go(getFib,[ channel_ch ] );
}

function *getFib(_,channelCh) {
	var ch = yield ASQ.csp.take(channelCh);
	if (ch === ASQ.csp.CLOSED) return;
	channelCh.close();

	// wait for FIB(n) request
	var n = yield ASQ.csp.take(ch);

	// calculate FIB(n)
	var fib = calcFib(n);

	// send answer back
	yield ASQ.csp.put(ch,fib);
}

// silly/naive fibonnaci
function calcFib(n) {
	if (n > 1) {
		return calcFib(n-1) + calcFib(n-2);
	}
	else {
		return n;
	}
}

function router(req,res) {
	res.writeHead(200,{ "Content-Type": "text/plain" });
	res.end("Nothing to see here.");
}

// adapted from: http://blog.stevenlevithan.com/archives/parseuri
function parseUri(r){for(var e={key:["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"],q:{name:"queryKey",parser:/(?:^|&)([^&=]*)=?([^&]*)/g},parser:{loose:/^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/}},o=e.parser.loose.exec(r),a={},s=14;s--;)a[e.key[s]]=o[s]||"";return a[e.q.name]={},a[e.key[12]].replace(e.q.parser,function(r,o,s){o&&(a[e.q.name][o]=s)}),a}
