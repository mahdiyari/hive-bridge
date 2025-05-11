// peer.ts

import { parse } from 'https://deno.land/std@0.224.0/flags/mod.ts'
import { v4 as uuidv4 } from 'https://deno.land/std@0.224.0/uuid/mod.ts'
import { randomUUID } from 'node:crypto'

const DEFAULT_PORT = 8080
const PING_INTERVAL = 5000 // ms
const RECONNECT_INTERVAL = 5000 // ms

interface PeerAddr {
	hostname: string
	port: number
}

interface Message {
	id: string
	type: 'ping' | 'pong' | 'hello'
	timestamp: number
	originAddr?: string // For hello messages
	originalTimestamp?: number // For pong messages
	data?: any
	peerId?: string // Unique ID of the sending peer
}

class Peer {
	private ownId: string
	private ownAddr: PeerAddr
	private wsServer?: Deno.HttpServer
	private peers: Map<string, WebSocket> = new Map() // peerId -> WebSocket
	private knownPeerAddrs: Set<string> = new Set() // "hostname:port"
	private pendingConnections: Set<string> = new Set() // "hostname:port"
	private pingTimers: Map<string, number> = new Map() // peerId -> intervalId for sending pings
	private sentPings: Map<string, number> = new Map() // messageId -> sendTimestamp

	constructor(port: number = DEFAULT_PORT, initialPeers: string[] = []) {
		this.ownId = randomUUID()
		this.ownAddr = { hostname: '0.0.0.0', port } // Listen on all interfaces
		console.log(`[${this.ownId}] Initializing peer on port ${port}`)
		initialPeers.forEach((addrStr) => {
			if (
				`127.0.0.1:${this.ownAddr.port}` !== addrStr &&
				`localhost:${this.ownAddr.port}` !== addrStr
			) {
				this.knownPeerAddrs.add(addrStr)
			}
		})
	}

	private getPeerAddressString(addr: PeerAddr): string {
		return `${addr.hostname}:${addr.port}`
	}

	async start(): Promise<void> {
		console.log(
			`[${this.ownId}] Starting peer server on ws://${this.ownAddr.hostname}:${this.ownAddr.port}`,
		)
		this.wsServer = Deno.serve(
			{ port: this.ownAddr.port, hostname: this.ownAddr.hostname },
			(req) => this.handleHttpRequest(req),
		)

		// Attempt to connect to known peers
		this.connectToKnownPeers()

		// Periodically try to reconnect to known peers if not connected
		// setInterval(() => {
		// 	this.knownPeerAddrs.forEach((addrStr) => {
		// 		const [hostname, portStr] = addrStr.split(':')
		// 		const port = parseInt(portStr)
		// 		const isConnected = Array.from(this.peers.values()).some((ws) => {
		// 			try {
		// 				const url = new URL(ws.url)
		// 				return url.hostname === hostname && parseInt(url.port) === port
		// 			} catch {
		// 				return false
		// 			}
		// 		})
		// 		if (!isConnected && !this.pendingConnections.has(addrStr)) {
		// 			console.log(`[${this.ownId}] Attempting to reconnect to ${addrStr}`)
		// 			this.connectToPeer({ hostname, port })
		// 		}
		// 	})
		// }, RECONNECT_INTERVAL * 2) // Longer interval for general reconnections
	}

	private handleHttpRequest(req: Request): Response {
		if (req.headers.get('upgrade') !== 'websocket') {
			return new Response('Not a WebSocket request', { status: 400 })
		}
		const { socket, response } = Deno.upgradeWebSocket(req)
		const remoteAddrObj = req.headers.get('x-forwarded-for') || // For proxies
			(socket as any).remoteAddr?.hostname || // Deno specific might not always be available
			'unknown'
		let remotePeerId: string | undefined

		socket.onopen = () => {
			// A peer connected to us. We don't know its ID or listening port yet.
			// We expect a 'hello' message.
			console.log(
				`[${this.ownId}] Incoming WebSocket connection opened from ${remoteAddrObj}`,
			)
		}

		socket.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data as string) as Message
				// console.log(`[${this.ownId}] Received message from ${remoteAddrObj}:`, message);

				if (message.type === 'hello') {
					remotePeerId = message.peerId
					if (remotePeerId && !this.peers.has(remotePeerId)) {
						this.peers.set(remotePeerId, socket)
						console.log(
							`[${this.ownId}] Peer ${remotePeerId} (${message.originAddr}) said hello. Connection established.`,
						)
						// Add to known peers if it's new and it provided its listening address
						if (
							message.originAddr &&
							message.originAddr !== this.getPeerAddressString(this.ownAddr)
						) {
							this.knownPeerAddrs.add(message.originAddr)
						}
						this.startPinging(remotePeerId, socket)
					} else if (remotePeerId && this.peers.has(remotePeerId)) {
						// console.log(`[${this.ownId}] Received hello from already known peer ${remotePeerId}. Updating socket.`);
						this.peers.set(remotePeerId, socket) // Update socket if re-hello
					}
				} else if (remotePeerId && this.peers.has(remotePeerId)) { // Ensure peer is identified
					this.handleMessage(remotePeerId, message, socket)
				} else if (!remotePeerId && message.peerId) { // If first message after open isn't hello but has peerId
					remotePeerId = message.peerId
					// console.warn(`[${this.ownId}] Received message from unidentified peer ${remoteAddrObj}, but message contains peerId ${remotePeerId}. Processing.`);
					this.handleMessage(remotePeerId, message, socket)
				} else {
					console.warn(
						`[${this.ownId}] Received message from unidentified or unhelloed peer ${remoteAddrObj}. Message:`,
						message,
					)
				}
			} catch (error) {
				console.error(
					`[${this.ownId}] Error processing message from ${remoteAddrObj}:`,
					error,
				)
			}
		}

		socket.onclose = () => {
			if (remotePeerId && this.peers.has(remotePeerId)) {
				console.log(
					`[${this.ownId}] Connection with peer ${remotePeerId} closed.`,
				)
				this.stopPinging(remotePeerId)
				this.peers.delete(remotePeerId)
			} else {
				console.log(
					`[${this.ownId}] Incoming WebSocket connection from ${remoteAddrObj} closed (peer never identified or already removed).`,
				)
			}
		}

		socket.onerror = (error) => {
			console.error(
				`[${this.ownId}] WebSocket error with ${
					remotePeerId || remoteAddrObj
				}:`,
				error,
			)
			// onclose will usually follow
		}
		return response
	}

	private handleMessage(
		peerId: string,
		message: Message,
		socket: WebSocket,
	): void {
		switch (message.type) {
			case 'ping':
				// console.log(`[${this.ownId}] Received PING (id: ${message.id}) from peer ${peerId}. Sending PONG.`);
				this.sendMessage(socket, {
					id: randomUUID(),
					type: 'pong',
					timestamp: Date.now(),
					originalTimestamp: message.timestamp,
					peerId: this.ownId,
				})
				break
			case 'pong': {
				const sendTime = this.sentPings.get(message.id) // Use original ping's message.id if pong doesn't have its own
				if (sendTime && message.originalTimestamp) {
					const rtt = Date.now() - message.originalTimestamp
					console.log(
						`[${this.ownId}] Received PONG from peer ${peerId} (original ping id: ${message.id}). RTT: ${rtt}ms`,
					)
					this.sentPings.delete(message.id)
				} else if (message.originalTimestamp) {
					// Fallback if not tracking by pong's ID but original ping's timestamp
					const rtt = Date.now() - message.originalTimestamp
					console.log(
						`[${this.ownId}] Received PONG from peer ${peerId}. RTT: ${rtt}ms`,
					)
				} else {
					console.log(
						`[${this.ownId}] Received PONG from peer ${peerId} (original timestamp missing or untracked).`,
					)
				}
				break
			}
			default:
				console.warn(
					`[${this.ownId}] Received unknown message type '${message.type}' from peer ${peerId}.`,
				)
		}
	}

	private async connectToPeer(peerAddr: PeerAddr): Promise<void> {
		const addrStr = this.getPeerAddressString(peerAddr)
		if (
			addrStr === this.getPeerAddressString(this.ownAddr) ||
			this.pendingConnections.has(addrStr)
		) {
			return
		}

		// Check if already connected by checking peer map values' URLs
		for (const ws of this.peers.values()) {
			try {
				const url = new URL(ws.url)
				if (
					url.hostname === peerAddr.hostname &&
					parseInt(url.port) === peerAddr.port
				) {
					// console.log(`[${this.ownId}] Already connected to ${addrStr}.`);
					return
				}
			} catch { /* Ignore invalid URLs, socket might be closing */ }
		}

		console.log(`[${this.ownId}] Attempting to connect to peer ${addrStr}...`)
		this.pendingConnections.add(addrStr)

		try {
			const socket = new WebSocket(`ws://${addrStr}`)
			let remotePeerId: string | undefined

			socket.onopen = () => {
				this.pendingConnections.delete(addrStr)
				console.log(
					`[${this.ownId}] Connection opened to ${addrStr}. Sending HELLO.`,
				)
				// Send a hello message with our ID and listening address
				this.sendMessage(socket, {
					id: randomUUID(),
					type: 'hello',
					timestamp: Date.now(),
					peerId: this.ownId,
					originAddr: `127.0.0.1:${this.ownAddr.port}`, // Send reachable address
				})
			}

			socket.onmessage = (event) => {
				try {
					const message = JSON.parse(event.data as string) as Message
					// console.log(`[${this.ownId}] Received message from ${addrStr}:`, message);

					if (message.type === 'hello') { // Could be a hello back from them
						remotePeerId = message.peerId
						if (remotePeerId && !this.peers.has(remotePeerId)) {
							this.peers.set(remotePeerId, socket)
							console.log(
								`[${this.ownId}] Peer ${remotePeerId} (${addrStr}) acknowledged HELLO. Connection established.`,
							)
							this.startPinging(remotePeerId, socket)
						} else if (remotePeerId && this.peers.has(remotePeerId)) {
							// console.log(`[${this.ownId}] Received hello from already known peer ${remotePeerId}. Updating socket.`);
							this.peers.set(remotePeerId, socket) // Update socket
						}
					} else if (remotePeerId && this.peers.has(remotePeerId)) { // If peer identified, handle other messages
						this.handleMessage(remotePeerId, message, socket)
					} else if (!remotePeerId && message.peerId) { // If first message after open isn't hello but has peerId
						remotePeerId = message.peerId
						this.peers.set(remotePeerId, socket)
						console.warn(
							`[${this.ownId}] Outgoing connection to ${addrStr} sent first message (type: ${message.type}) with peerId ${remotePeerId} before hello response. Processing.`,
						)
						this.handleMessage(remotePeerId, message, socket)
						this.startPinging(remotePeerId, socket) // Start pinging if not already
					} else {
						console.warn(
							`[${this.ownId}] Received message from ${addrStr} before HELLO response or identification:`,
							message,
						)
					}
				} catch (error) {
					console.error(
						`[${this.ownId}] Error processing message from ${addrStr}:`,
						error,
					)
				}
			}

			socket.onclose = () => {
				this.pendingConnections.delete(addrStr)
				if (remotePeerId && this.peers.has(remotePeerId)) {
					console.log(
						`[${this.ownId}] Connection with peer ${remotePeerId} (${addrStr}) closed.`,
					)
					this.stopPinging(remotePeerId)
					this.peers.delete(remotePeerId)
				} else {
					console.log(
						`[${this.ownId}] Connection to ${addrStr} closed (peer never identified or already removed).`,
					)
				}
				// Optional: Attempt to reconnect after a delay
				setTimeout(() => {
					if (
						!this.isPeerConnectedById(remotePeerId) &&
						this.knownPeerAddrs.has(addrStr)
					) {
						console.log(
							`[${this.ownId}] Attempting to reconnect to ${addrStr} after close.`,
						)
						this.connectToPeer(peerAddr)
					}
				}, RECONNECT_INTERVAL)
			}

			socket.onerror = (error) => {
				this.pendingConnections.delete(addrStr)
				console.error(`[${this.ownId}] WebSocket error with ${addrStr}:`, error)
				if (remotePeerId) this.stopPinging(remotePeerId)
				// onclose will usually follow
			}
		} catch (error: any) {
			this.pendingConnections.delete(addrStr)
			console.error(
				`[${this.ownId}] Failed to connect to peer ${addrStr}:`,
				error.message,
			)
			// Optional: Attempt to reconnect after a delay
			setTimeout(() => {
				if (this.knownPeerAddrs.has(addrStr)) { // Only retry if it's a known peer
					console.log(
						`[${this.ownId}] Attempting to reconnect to ${addrStr} after failure.`,
					)
					this.connectToPeer(peerAddr)
				}
			}, RECONNECT_INTERVAL)
		}
	}

	private isPeerConnectedById(peerId?: string): boolean {
		return !!peerId && this.peers.has(peerId) &&
			this.peers.get(peerId)?.readyState === WebSocket.OPEN
	}

	private connectToKnownPeers(): void {
		this.knownPeerAddrs.forEach((addrStr) => {
			const [hostname, portStr] = addrStr.split(':')
			if (hostname && portStr) {
				this.connectToPeer({ hostname, port: parseInt(portStr) })
			}
		})
	}

	private startPinging(peerId: string, socket: WebSocket): void {
		if (this.pingTimers.has(peerId)) {
			clearInterval(this.pingTimers.get(peerId))
		}
		console.log(
			`[${this.ownId}] Starting to ping peer ${peerId} every ${
				PING_INTERVAL / 1000
			}s.`,
		)
		const intervalId = setInterval(() => {
			if (socket.readyState === WebSocket.OPEN) {
				const pingId = randomUUID()
				const message: Message = {
					id: pingId,
					type: 'ping',
					timestamp: Date.now(),
					peerId: this.ownId,
				}
				// console.log(`[${this.ownId}] Sending PING (id: ${pingId}) to peer ${peerId}`);
				this.sendMessage(socket, message)
				this.sentPings.set(pingId, message.timestamp)
			} else {
				console.warn(
					`[${this.ownId}] Cannot ping peer ${peerId}, WebSocket is not open (state: ${socket.readyState}).`,
				)
				this.stopPinging(peerId) // Stop trying if not open
				if (this.peers.has(peerId)) this.peers.delete(peerId) // Clean up
			}
		}, PING_INTERVAL)
		this.pingTimers.set(peerId, intervalId)
	}

	private stopPinging(peerId: string): void {
		if (this.pingTimers.has(peerId)) {
			clearInterval(this.pingTimers.get(peerId))
			this.pingTimers.delete(peerId)
			console.log(`[${this.ownId}] Stopped pinging peer ${peerId}.`)
		}
	}

	private sendMessage(socket: WebSocket, message: Message): void {
		if (socket.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(message))
		} else {
			console.warn(
				`[${this.ownId}] Could not send message, WebSocket not open. Message:`,
				message,
			)
		}
	}

	public getPeerConnections(): { id: string; url: string; state: string }[] {
		const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED']
		return Array.from(this.peers.entries()).map(([id, ws]) => ({
			id,
			url: ws.url,
			state: states[ws.readyState],
		}))
	}

	public getOwnId(): string {
		return this.ownId
	}
}

async function main() {
	const { port, peers: initialPeersStr } = parse(Deno.args, {
		alias: { p: 'port', P: 'peers' },
		string: ['peers'],
		default: { port: DEFAULT_PORT },
	})

	const peerPort = typeof port === 'number' ? port : DEFAULT_PORT

	let initialPeersList: string[] = []
	if (initialPeersStr) {
		initialPeersList = initialPeersStr.split(',').map((s) => s.trim()).filter(
			(s) => s.length > 0,
		)
	}

	if (initialPeersList.length === 0 && Deno.args.length === 0) {
		console.warn(
			'No initial peers specified. This peer will only listen for incoming connections.',
		)
		console.warn(
			'To connect to other peers, use the --peers flag, e.g.: --peers localhost:8081,localhost:8082',
		)
	}

	const peer = new Peer(peerPort, initialPeersList)
	await peer.start()

	// Keep the process alive and optionally log status
	// setInterval(() => {
	//   console.log(`[${peer.getOwnId()}] Current active connections: ${peer.getPeerConnections().filter(p=>p.state === "OPEN").length}`);
	//   // peer.getPeerConnections().forEach(p => console.log(`  - ${p.id} @ ${p.url} (${p.state})`));
	// }, 15000);
}

if (import.meta.main) {
	await main()
}
