importScripts(
	"../../node_modules/asynquence/asq.js",
	"../../node_modules/asynquence-contrib/contrib-es6.src.js",
	"../../index.js",
	"../../transports/webworker/index.js"
);

RemoteCSPChannel.initCSP(
	/*API=*/ASQ.csp,
	/*channelFactory=*/ASQ.csp.chan,
	/*returnAsPromise=*/function $$promisewrap(v){
		return (ASQ.isSequence(v) ? v : ASQ(v)).toPromise();
	}
);

ASQ().runner( ASQ.csp.go(workerProc) )
.val(function(){
	console.log("remote complete");
});


// ***********************

function *workerProc(){
	var params = parseHash(self.location.href),
		transport_id = params.tr || "WWTR",
		channel_id = params.ch || "WWCH";

	RemoteCSPChannel.defineTransport(
		/*transportName=*/transport_id,
		/*transport=*/TransportWebWorker
	);

	var ch = yield RemoteCSPChannel.openChannel(transport_id,channel_id);

	console.log("(" + channel_id + ") channel opened");

	for (var i=0; i<1E9; i++) {}

	yield ASQ.csp.put(ch,i);

	console.log("(" + channel_id + ") message sent");
}

// adapted from: http://blog.stevenlevithan.com/archives/parseuri
function parseHash(t){var a="",e={};return/#./.test(t)&&(a=t.match(/#(.*)$/)[1],a.replace(/(?:^|&)([^&=]*)=?([^&]*)/g,function(t,a,n){a&&(e[a]=n)})),e}
