(function UMD(name,context,definition){
	if (typeof define === "function" && define.amd) { define(definition); }
	else if (typeof module !== "undefined" && module.exports) { module.exports = definition(); }
	else { context[name] = definition(name,context); }
})("RemoteCSPChannel",this,function DEF(name,context){
	"use strict";

	var bridges = {},
		orig_csp,
		publicAPI = {
			hijackCSP: hijackCSP,
			defineBridge: defineBridge,
			openChannel: openChannel
		};

	if (typeof ASQ != "undefined" && ASQ.csp) {
		hijackCSP(ASQ.csp);
	}

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

			pr = bridges[bridgeName].open(channelID)
				.then(remoteOpened);
		}

		return (pr || new Promise(function noop(){}));


		// ***************************

		function getChannel(bufSize) {
			var ch = ASQ.csp.chan(bufSize),
				chanClose = ch.close;

			ch.close = function $$close() {
				bridges[bridgeName].close(bridgeName,channelID);
				chanClose();
			};

			return ch;
		}

		function remoteOpened() {
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
			take: makeCSPMethodWrapper("take",orig),
			put: makeCSPMethodWrapper("put",orig),
			alts: makeCSPMethodWrapper("alts",orig),
			takem: makeCSPMethodWrapper("takem",orig),
			takeAsync: makeCSPMethodWrapper("takeAsync",orig),
			takemAsync: makeCSPMethodWrapper("takemAsync",orig),
			putAsync: makeCSPMethodWrapper("putAsync",orig),
			altsAsync: makeCSPMethodWrapper("altsAsync",orig)
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
				args.unshift(methodName);
				return bridges[ch.remote[0]].signal.apply(null,args);
			}
			else {
				return orig[methodName].apply(null,args);
			}
		};
	}

});
