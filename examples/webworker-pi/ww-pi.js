(function(){
	"use strict";

	var transport_ids = {},
		channel_ids = {},
		local_channels = [],

		worker_count = 4,
		digits_per_worker = 5,

		overall_digit_count = 0;

	RemoteCSPChannel.initCSP(
		/*API=*/ASQ.csp,
		/*channelFactory=*/ASQ.csp.chan,
		/*returnAsPromise=*/function $$promisewrap(v){
			return (ASQ.isSequence(v) ? v : ASQ(v)).toPromise();
		}
	);

	ASQ().runner( ASQ.csp.go(main) );


	// ****************************

	function *main(ch){
		var indx, i, localCh, hex, dec, cur,
			between_hidden = true,

			digit_count = document.getElementById("digit-count"),
			first_digits = document.getElementById("first-digits"),
			between_digits = document.getElementById("between-digits"),
			recent_digits = document.getElementById("recent-digits");


		for (indx=0; indx < worker_count; indx++) {
			localCh = ASQ.csp.chan();
			local_channels.push(localCh);
			spinUpWorkerProcess(ch.go,indx,localCh);
		}

		indx = 0;
		while (true) {
			for (i=0; i < digits_per_worker; i++) {
				hex = yield ASQ.csp.take(local_channels[indx]);
				dec = nextHexToDec(hex);

				overall_digit_count++;
				digit_count.innerHTML = overall_digit_count;

				if (overall_digit_count <= 10) {
					first_digits.innerHTML += dec;
				}
				else {
					cur = recent_digits.innerHTML + dec;
					if (cur.length > 20) {
						cur = cur.substr(cur.length - 20);
						if (between_hidden) {
							between_digits.style.display = "inline";
							between_hidden = true;
						}
					}
					recent_digits.innerHTML = cur;
				}
			}

			indx = (indx + 1) % worker_count;
		}
	}

	function spinUpWorkerProcess(go,index,localCh) {
		var transport_id = getNewTransportID("WWTR"),
			channel_id = getNewChannelID("WWCH");

		RemoteCSPChannel.defineTransport(
			/*transportID=*/transport_id,
			/*transport=*/TransportWebWorker,

			// transport args:
			new Worker("worker-process.js#tr=" + transport_id + "&ch=" + channel_id)
		);

		go(remoteProc,[ transport_id, channel_id, index, localCh ]);
	}

	function *remoteProc(_,transportID,channelID,index,localCh) {
		var ch = yield RemoteCSPChannel.openChannel(transportID,channelID),
			hexdigit;

		// where should each worker start?
		index = index * digits_per_worker;

		while (true) {
			// tell the worker what index it starts at
			yield ASQ.csp.put(ch,index);

			for (var i=0; i < digits_per_worker; i++) {
				// get digit from worker
				hexdigit = yield ASQ.csp.take(ch);

				// push digit to local handler
				yield ASQ.csp.put(localCh,hexdigit);
			}

			index += (worker_count * digits_per_worker);
		}
	}

	var nextHexToDec = (function(){
		var holding = 0, position = 0;

		return function nextHexToDec(hexChar) {
			var dec = parseInt(hexChar,16) / Math.pow(16,position+1) * Math.pow(10,position+1);
			dec = dec + holding;
			var whole = Math.floor(dec);
			holding = (dec % 1) * 10;
			position++;
			return whole;
		}
	})();

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
