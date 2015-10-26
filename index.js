(function UMD(name,context,definition){
	if (typeof define === "function" && define.amd) { define(definition); }
	else if (typeof module !== "undefined" && module.exports) { module.exports = definition(); }
	else { context[name] = definition(name,context); }
})("RemoteCSPChannel",this,function DEF(name,context){
	"use strict";

	var bridges = {},
		orig_csp,
		rejected_pr = Promise.reject(),
		publicAPI = {
			hijackCSP: hijackCSP,
			defineBridge: defineBridge,
			openChannel: openChannel
		};

	// opting out of false "unhandled rejection" warnings
	rejected_pr.catch(function noop(){});

	return publicAPI;


	// ***************************

	function defineBridge(bridgeName,handlers) {
		bridges[bridgeName] = handlers;
	}

	function openChannel(bridgeName,channelID,bufSize) {
		var pr, ch;

		if (bridges[bridgeName]) {
			ch = getChannel(bufSize || 0);
			ch.remote = [bridgeName,channelID];
			pr = bridges[bridgeName].open(ch);
		}

		return (pr || rejected_pr);


		// ***************************

		function getChannel(bufSize) {
			// TODO: factor out `ASQ.csp.chan(..)`
			var ch = ASQ.csp.chan(bufSize);

			// save original close() method
			ch.origClose = ch.close;

			// wrap close method: also signal remote close
			ch.close = function $$close() {
				bridges[bridgeName].close(channelID);
				ch.origClose();
			};

			return ch;
		}
	}

	function hijackCSP(csp) {
		// save existing API methods
		orig_csp = {
			take: csp.take,
			put: csp.put,
			alts: csp.alts,
			takem: csp.takem,
			takeAsync: csp.takeAsync,
			takemAsync: csp.takemAsync,
			putAsync: csp.putAsync,
			altsAsync: csp.altsAsync
		};

		Object.assign(csp,{
			take: makeCSPMethodWrapper("take",orig_csp),
			put: makeCSPMethodWrapper("put",orig_csp),
			alts: makeCSPMethodWrapper("alts",orig_csp),
			takem: makeCSPMethodWrapper("takem",orig_csp),
			takeAsync: makeCSPMethodWrapper("takeAsync",orig_csp),
			takemAsync: makeCSPMethodWrapper("takemAsync",orig_csp),
			putAsync: makeCSPMethodWrapper("putAsync",orig_csp),
			altsAsync: makeCSPMethodWrapper("altsAsync",orig_csp)
		});
	}

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

			if (ch.remote && bridges[ch.remote[0]]) {
				args.unshift(
					/*channelID=*/ch.remote[1],
					/*cspMethod=*/methodName
				);
				return bridges[ch.remote[0]].signal.apply(null,args);
			}
			else {
				return orig[methodName].apply(null,args);
			}
		};
	}

});
