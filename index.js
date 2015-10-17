var RemoteCSPChannel = (function RCSP(){

	var bridges = {},
		publicAPI = {
			defineBridge: defineBridge,
			openChannel: openChannel
		};

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

})();
