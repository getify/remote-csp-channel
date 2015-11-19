# Remote CSP Channel

A [CSP (Communicating Sequential Processes)](https://github.com/getify/asynquence/tree/master/contrib#go-style-csp-api-emulation) channel that bridges to remote contexts.

## Overview

This library provides facilities for defining CSP channels that are transparently bridged across a transport layer to a remote context. A remote channel is used in your CSP code identically to a local channel.

`RemoteCSPChannel` includes the following three API methods:

* `initCSP(..)`: wraps CSP methods to make working with remote channels transparent
* `defineTransport(..)`: defines a transport (adapter) instance to carry the messages from the `RemoteCSPChannel` library between the local and remote contexts
* `openChannel(..)`: opens a channel instance for a specified transport

`RemoteCSPChannel` implements a signal/ACK protocol to communicate with a remote context and ensure that both sides of the communication are in sync with CSP actions. It relies on a transport (adapter) to actually carry the message to a remote process.

## Transports

The following transports are currently available (more to come):

* Web Worker (Dedicated or Shared): [`transports/webworker`](../../tree/master/transports/webworker) (`TransportWebWorker`)
* Socket.io: [`transports/socketio`](../../tree/master/transports/socketio) (`TransportSocketIO`)
* Node.js I/O Stream: [`transports/nodestream`](../../tree/master/transports/nodestream) (`TransportNodeStream`)

Transports are responsible for ensuring messages are delivered in both directions, between the local and remote contexts.

### Building Your Own Transport

The easiest transport to inspect to see how to define other transports is the [`transports/socketio`](../../tree/master/transports/socketio/index.js) transport.

A transport must expose a public API method called `connect(..)`. Arguments to this `connect(..)` method passed by the `RemoteCSPChannel.defineTransport(..)` utility (see below).

`connect(..)` must return an object with two members:

* `onMessage(..)`: this method will be called once by `RemoteCSPChannel` and passed a single function reference as argument; save a reference to that received function. Any time a message is received from the remote context, pass it to the saved function so that `RemoteCSPChannel` can handle it.
* `sendMessage(..)`: this method will be called automatically by `RemoteCSPChannel` any time it needs to send a message to the remote context. It will receive a single argument which is a message object. You must serialize and/or transfer that message to the remote context, and ensure it's reconstructed (as necessary) as the message object.

**Note:** You do not need to implement any special signaling/ACKing protocols, as the `RemoteCSPChannel` handles that. However, depending on the nuances of the transport type, other message stream processing may be necessary. For example, see `transports/nodestream` for how message delimiter text is added and parsed, to counteract OS level message bundling that happens over certain types of I/O streams.

## How To Use

There are three setup steps to prepare your CSP to use a remote channel.

### Initialize CSP

**(1)** Adapt your lib's CSP methods to transparently handle remote channels as well as local channels:

```js
RemoteCSPChannel.initCSP(
	%csp-lib-namespace%,
	%csp-channel-factory%,

	// optional:
	%promisewrapper%
);
```

`%csp-lib-namespace%` is the namespace object for your CSP lib, such as `csp`. For [asynquence's CSP](https://github.com/getify/asynquence/tree/master/contrib#go-style-csp-api-emulation), it would be `ASQ.csp`. If your lib has all methods in the global namespace (boo!), pass an object with references for each method (such as `{ put: put, take: take, .. }`), and then make sure to use the replaced wrapped methods on that object instead of the global ones.

`%csp-channel-factory%` is a reference to the function your CSP lib provides for creating normal local channels, such as `chan`. For [asynquence's CSP](https://github.com/getify/asynquence/tree/master/contrib#go-style-csp-api-emulation), it would be `ASQ.csp.chan`.

`%promisewrapper%` (optional) is a function used to wrap the return values from a CSP lib's methods (like `put(..)` and `take(..)`) into a normal Promise, if it's not already that way. If your CSP lib already returns promises, you can omit this argument. For [asynquence's CSP](https://github.com/getify/asynquence/tree/master/contrib#go-style-csp-api-emulation), which returns sequences instead of normal promises, the wrapper function could be:

```js
function promisewrap(v) {
	return (ASQ.isSequence(v) ? v : ASQ(v)).toPromise();
}
```

### Define Transport

**(2)** Setup an instance of a transport for remote channel bridging:

```js
RemoteCSPChannel.defineTransport(
	"%unique-transport-id%",
	%transport-type%,

	// optional:
	%transport-args% [, .. ]
);
```

`%unique-transport-id%` is a string value used for the transport ID and can be anything you want. It must be unique within the program and must match on both sides of your remote CSP.

`%transport-type%` is the chosen transport factory (like `TransportSocketIO`). See [Transports](#transports) for available options.

`%transport-args` (optional) specify arguments to pass along automatically to the transport factory. For example, if the browser is spinning up a web worker bridged channel, you'd need to create a `new Worker(" .. ")` instance to pass in.

### Open Channel

**(3)** Open up a remote channel:

```js
var pr = RemoteCSPChannel.openChannel(
	"%transport-id%",
	"%channel-id%"
);
```

`%transport-id%` is the same string value you used to define the transport you want to use.

`%channel-id` is a unique string value that represents a channel. This ID must be globally unique (not per transport) and must match on both sides of your remote CSP.

`openChannel(..)` returns promise for the channel, which will resolve with the actual channel object once it's been opened on both sides of your remote CSP. You can wait for that channel value resolution using a normal `Promise#then(..)` approach, or (preferred) `yield` in a generator.

### Using a Channel

Now you can use the remote channel throughout your program (with `put(..)` and `take(..)`, etc), just like any normal local channel:

```js
// note: `remoteCh` already opened

go(function *localProc(){
	var meaning = yield take( remoteCh );
	console.log( meaning );
});

// ********************************
// and on in some remote context:

go(function *remoteProc(){
	yield put( remoteCh, 42 );
});
```

That's pretty much it!

### Transport ID and Channel ID

It's very important to recognize that you will need a mechanism for determining (or generating) a unique string value for both a transport ID and a channel ID. These must both be unique within your application; you cannot use the same channel ID across two different transports.

For example, if you have a Socket.io server process receiving incoming connections from clients, you'll obviously need to have a different transport ID for each client-server connection, since the server cannot use the same transport ID for multiple transports, and each transport must be directly connected to a socket.

Since both sides of a remote channel need to agree on the transport ID and channel ID, and since you may need to actually generate these values to ensure their uniqueness, you may very well have to pass the transport ID and/or channel ID manually to or from the remote context during initial connections.

In the code for the [Examples](#examples) (see below), you'll see one way of handling this: by passing the transport ID and channel ID in the URL for connection to a Web Worker or Socket.io server. For Node.js child processes, the IDs are passed along as shell arguments.

How you choose to manage or send these IDs is entirely up to you. They just have to be unique and match on both sides.

## Examples

See the [`examples/`](../../tree/master/examples/) directory for the following examples:

* [Long-running Loop](../../tree/master/examples/webworker-socketio-childproc) (Web Worker + Socket.io + Node.js Child Process)
* [Fibonacci](../../tree/master/examples/socketio-fib) (Socket.io)
* [Pi Digits](../../tree/master/examples/webworker-pi) (Web Worker)
* [Long-running Loop](../../tree/master/examples/net-socket-client-server) (Node.js `net.Socket` Client / Server)

To run the examples:

1. Clone this repo
2. Run `npm install` to install `devDependencies`
3. For the examples with server components, start up the appropriate server at the command line with `node ____.js`
4. For the examples with a web page UI:
	* run a local file server (like `python -m SimpleHTTPServer 8080`, etc) in the root directory of this repo, to serve up the HTML/JS files to the browser
	* open up the appropriate `index.html` file in your browser

## Known Issues

This project is at a very early alpha stage. There are a number of caveats to be aware of:

* An assumption is made of the method names for CSP actions: `put`, `take`, etc. If your lib's method names don't match, you may have to create your own adaptation layer.
* Local CSP channels can have a buffer size > 1, but `RemoteCSPChannel` doesn't yet support those semantics. This is very difficult to achieve.
* Currently only `put(..)` and `take(..)` is supported. CSP `alts(..)`, for example, is **much more complicated** to negotiate across multiple contexts, so they are not yet supported.
* If you have a **local** `put(..)` and `take(..)` on the same **remote** channel, an assumption is made that you'd like to fulfill that action locally and not remotely. It will attempt to signal the remote context to tell it to cancel the first (already-messaged) remote behavior. However, that cancelation may not fully work yet, which means that remote channel may get into a weird state.

## License

The code and all the documentation are released under the MIT license.

http://getify.mit-license.org/
