import { randomUUID } from 'node:crypto'
import * as uuid from '@std/uuid'
import { messageChecksum } from '../helpers/p2p/message_checksum.ts'
import { getMyIp } from '../helpers/general/get_my_ip.ts'
import { messageHash } from '../helpers/p2p/message_hash.ts'
import { isIPv4, isIPv6 } from 'node:net'
import {
	EventDetail,
	FullHelloAckMessage,
	FullHelloMessage,
	FullMessage,
	HelloAckMessage,
	HelloMessage,
	Message,
	PeerMessageEvent,
} from '../helpers/p2p/types.ts'
import { pendingWraps } from './PendingWraps.ts'
import { pendingUnwraps } from './PendingUnwraps.ts'
import { bytesToHex } from '@noble/hashes/utils'
import { signHeartbeat, validateHeartbeat } from '../helpers/p2p/heartbeat.ts'
import { PrivateKey } from 'hive-tx'
import { peers } from './Peers.ts'
import { operators } from './Operators.ts'
import { sleep } from '../helpers/general/sleep.ts'
// import { generate } from 'selfsigned'

export class P2PNetwork {
	private knownPeers: string[] = []
	// Will have double this number of peers connected (50% public + 50% private)
	private maxPeers = 5
	private messageRateLimit = 10 // per second
	private messagesInLastSecond: Map<string, number> = new Map()
	private port: number
	/** Randomly generated uuidv4 */
	private myId: string
	/** It will be automatically saved as ipv4 or [ipv6] */
	private myIP: string = 'none'
	private event = new EventTarget()

	constructor(knownPeers?: string[], port?: number) {
		this.knownPeers = Deno.env.get('PEERS')?.split(',') || []
		this.port = Number(Deno.env.get('P2P_PORT')) || 3018
		this.myId = randomUUID()
		this.startServer().then(() => {
			this.connectToKnownPeers()
			this.handlePeerList()
			this.initiateHeartbeat()
		})
		// Use this to rate limit messages received
		setInterval(() => {
			this.messagesInLastSecond.clear()
		}, 1_000)

		setInterval(() => {
			this.checkPeers()
		}, 10_000)
	}

	/** Receive messages from the P2P network */
	public onMessage(cb: (detail: EventDetail) => void) {
		this.event.addEventListener('peerMessage', (e) => {
			const pe = e as PeerMessageEvent
			cb(pe.detail)
		})
	}

	/** Prepare and send the message to all peers except the exception -
	 * exception: The peer who originally sent this message to us -
	 * We don't want to send it back there again
	 */
	public sendMessage(message: Message, exception?: string) {
		for (const peer of peers.getAllPeers()) {
			if (peer.id !== exception) {
				this.wsSend(peer.ws, message)
			}
		}
	}

	/** Send the signature to all peers */
	public sendSignature(operator: string, msgHash: string, signature: string) {
		const wrap = pendingWraps.getWrapByHash(msgHash)
		if (!wrap) {
			return
		}
		this.sendMessage({
			type: 'ETH_SIGNATURE',
			data: {
				operator,
				message: {
					address: wrap.message.address,
					amount: wrap.message.amount,
					blockNum: wrap.message.blockNum,
					contract: wrap.message.contract,
				},
				signature,
			},
		})
	}

	/** Send a hive signature to all peers */
	public sendHiveSignature(
		operator: string,
		ethTransactionHash: string,
		signature: string,
	) {
		const digest = pendingUnwraps.getUnwrap(ethTransactionHash)?.digest().digest
		if (!digest) {
			return
		}
		this.sendMessage({
			type: 'HIVE_SIGNATURE',
			data: {
				operator,
				message: {
					ethTransactionHash,
					digest: bytesToHex(digest),
				},
				signature,
			},
		})
	}

	/** Get the public IP and start listening for incoming connections */
	private async startServer() {
		const ip = await getMyIp()
		if (isIPv6(ip.ip)) {
			this.myIP = `[${ip.ip}]`
		} else if (isIPv4(ip.ip)) {
			this.myIP = ip.ip
		}
		// const attrs = [{ name: 'commonName', value: this.myIP }]
		// const pems = generate(attrs, {
		// 	days: 3650,
		// 	keySize: 2048,
		// 	algorithm: 'sha256',
		// })
		Deno.serve({
			hostname: Deno.env.get('LISTEN_HOST') || '::',
			port: this.port,
			// cert: pems.cert,
			// key: pems.private,
			handler: (request) => {
				if (request.headers.get('upgrade') === 'websocket') {
					const { socket, response } = Deno.upgradeWebSocket(request)
					this.handleIncomingConnection(socket)
					return response
				}
				if (request.method === 'GET') {
					// We use /status on the p2p port to detect if peer is publicly accessible
					const url = new URL(request.url)
					if (url.pathname === '/status') {
						return new Response(JSON.stringify({ status: 'OK' }), {
							status: 200,
							headers: {
								'Content-Type': 'application/json',
								'Cache-Control': 'no-store',
								'Access-Control-Allow-Origin': '*',
							},
						})
					}
				}
				return new Response('Not a websocket request', { status: 400 })
			},
		})
		console.log(
			`WebSocket server started on port ${this.port}, ID: ${this.myId}`,
		)
	}

	/** Handles the incoming connection and handshake from peers */
	private handleIncomingConnection(ws: WebSocket) {
		let successHandshake = false
		// timeout after 5 seconds
		setTimeout(() => {
			if (!successHandshake) {
				ws.close()
			}
		}, 5_000)

		ws.onmessage = (event) => {
			try {
				const message: FullHelloMessage = JSON.parse(event.data.toString())
				// Verify message integrity
				if (!messageChecksum(message)) {
					return ws.close()
				}
				// If not handshaked and the first message is not hello, close
				if (!successHandshake && message.type !== 'HELLO') {
					return ws.close()
				}
				// First message must be type HELLO
				if (message.type === 'HELLO') {
					// Experimental: Don't accept connections if we are at the peers limit
					// Might want to send list of our peers so they can connect instead?
					if (peers.getAllPeers().length >= this.maxPeers * 2) {
						return ws.close()
					}
					// Already handshaked?
					// Although this handler shouldn't receive this type of call
					// because we re-assign the onmessage after handshake
					if (successHandshake) {
						const ackMsg: HelloAckMessage = {
							type: 'HELLO_ACK',
							data: {
								peerId: this.myId,
							},
						}
						return this.wsSend(ws, ackMsg)
					}
					// Require ip address in incoming handshake
					if (!message.data?.address) {
						return ws.close()
					}
					// Require valid uuid in incoming handshake
					const remoteId = message.data.peerId
					if (!uuid.validate(remoteId)) {
						return ws.close()
					}
					// Don't connect to yourself
					if (remoteId === this.myId) {
						return ws.close()
					}
					// Validate and add new peer
					peers.addPeer(remoteId, ws, message.data.address, 'none')
					const ackMsg: HelloAckMessage = {
						type: 'HELLO_ACK',
						data: {
							peerId: this.myId,
						},
					}
					this.wsSend(ws, ackMsg)
					successHandshake = true
					// Re-assign the onmessage to another handler
					ws.onmessage = (event2) => {
						this.handleRegularMessage(
							event2.data.toString(),
							remoteId,
							ws,
						)
					}
					ws.onclose = () => {
						peers.removePeer(remoteId)
					}
					ws.onerror = () => {
						console.error(`WebSocket error:`, remoteId)
						peers.removePeer(remoteId)
					}
				} else {
					ws.close()
				}
			} catch {
				// Close the connection on malformed message
				ws.close()
			}
		}
	}

	/** Add timestamp and hash the message before sending to ws */
	private wsSend = (ws: WebSocket, msg: Message) => {
		if (ws.readyState === WebSocket.OPEN) {
			const timestamp = Date.now()
			const hash = messageHash(JSON.stringify({ ...msg, timestamp }))
			const fullMessage = { ...msg, timestamp, hash }
			// Add message to the seen list
			// so we don't broadcast it again when received from other peers
			peers.addMessage(hash, fullMessage)
			ws.send(JSON.stringify(fullMessage))
		} else {
			console.log(`ws connection is not open... removing the peer.`)
			ws.close()
		}
	}

	/** Regular messages after the initial handshake will be handled here */
	private handleRegularMessage(message: string, peerId: string, ws: WebSocket) {
		const recentMessageCount = this.messagesInLastSecond.get(peerId) || 0
		if (recentMessageCount > this.messageRateLimit) {
			console.warn(`Rate limit exceeded for peer: ${peerId}`)
			return
		}
		this.messagesInLastSecond.set(peerId, recentMessageCount + 1)

		try {
			const parsedMessage: FullMessage = JSON.parse(message)
			const checksum = messageChecksum(parsedMessage)
			if (!checksum) {
				ws.close()
				return
			}
			// If we have already seen this message, ignore it
			if (peers.messageSeen(parsedMessage.hash)) {
				return
			}
			console.log(parsedMessage)
			peers.addMessage(parsedMessage.hash, parsedMessage)
			const messageEvent = new CustomEvent('peerMessage', {
				detail: <EventDetail> {
					type: 'peerMessage',
					data: parsedMessage,
					sender: peerId,
				},
			})
			this.event.dispatchEvent(messageEvent)
			// Repeat to other peers if not personal communication
			if (
				parsedMessage.type !== 'HELLO' &&
				parsedMessage.type !== 'HELLO_ACK' &&
				parsedMessage.type !== 'REQUEST_PEERS' &&
				parsedMessage.type !== 'PEER_LIST'
			) {
				this.sendMessage(parsedMessage, peerId)
			}
		} catch {
			console.warn('malformed message from', peerId)
			// Remove the peer on malformed message
			ws.close()
		}
	}

	/** Add peers that are in knownPeers list */
	private connectToKnownPeers() {
		for (const peerAddress of this.knownPeers) {
			this.connectToPeer(peerAddress)
		}
	}

	/** peerAddress without ws:// */
	private connectToPeer(peerAddress: string) {
		try {
			let successHandshake = false
			const ws = new WebSocket(`ws://${peerAddress}`)
			// Send HELLO onOpen
			ws.onopen = () => {
				// Close the connection after 5s if not handshaked
				setTimeout(() => {
					if (!successHandshake) {
						ws.close()
					}
				}, 5_000)
				const helloMsg: HelloMessage = {
					type: 'HELLO',
					data: {
						peerId: this.myId,
						address: `${this.myIP}:${this.port}`,
					},
				}
				this.wsSend(ws, helloMsg)
			}
			ws.onmessage = (event) => {
				try {
					const message: FullHelloAckMessage = JSON.parse(
						event.data.toString(),
					)
					const checksum = messageChecksum(message)
					if (!checksum) {
						ws.close()
						return
					}
					if (message.type !== 'HELLO_ACK') {
						ws.close()
						return
					}
					if (!uuid.validate(message.data.peerId)) {
						ws.close()
						return
					}
					// Validate and add new peer
					peers.addPeer(
						message.data.peerId,
						ws,
						peerAddress,
						'none',
					)
					successHandshake = true
					// Re-assign the onmessage
					ws.onmessage = (event2) => {
						this.handleRegularMessage(
							event2.data.toString(),
							message.data.peerId,
							ws,
						)
					}
					ws.onclose = () => {
						peers.removePeer(message.data.peerId)
					}
					ws.onerror = () => {
						peers.removePeer(message.data.peerId)
					}
				} catch {
					ws.close()
				}
			}
			ws.onerror = () => {
				console.error(
					`Error connecting to known peer ${peerAddress}`,
				)
			}
		} catch {
			console.error(
				`Failed to connect to known peer ${peerAddress}`,
			)
		}
	}

	// Operators send a heartbeat message every 90s
	private initiateHeartbeat() {
		this.handleHeartbeat()
		const username = Deno.env.get('USERNAME')
		const activeKey = Deno.env.get('ACTIVE_KEY')
		if (!username || !activeKey) {
			return
		}
		setInterval(() => {
			const msg = {
				operator: username,
				peerId: this.myId,
				timestamp: Date.now(),
			}
			const signature = signHeartbeat(msg, PrivateKey.from(activeKey))
			console.log('sent heartbeat')
			this.sendMessage({
				type: 'HEARTBEAT',
				data: {
					...msg,
					signature,
				},
			})
			// Set our own operator's lastSeen
			operators.setOperatorLastSeen(username, Date.now())
		}, 90_000)
	}

	private handleHeartbeat() {
		this.event.addEventListener('peerMessage', (e) => {
			const pe = e as PeerMessageEvent
			const msg = pe.detail.data
			if (msg.type === 'HEARTBEAT') {
				const valid = validateHeartbeat(msg.data)
				if (valid) {
					// if heartbeat sender is the operator, set the operator name for that peer
					peers.receivedHeartbeat(msg.data.peerId, msg.data.operator)
					operators.setOperatorLastSeen(msg.data.operator, Date.now())
				}
				// Peer limit etc
				// TODO
			}
		})
	}

	private checkPeers() {
		const publicPeers = peers.getPublicPeers()
		const privatePeers = peers.getPrivatePeers()
		// Randomly remove peers if connected to more than maxPeers
		if (privatePeers.length > this.maxPeers) {
			const peersToRemove = privatePeers.length - this.maxPeers
			const rand = getRandomUniqueNumbers(0, privatePeers.length, peersToRemove)
			rand.forEach((val) => {
				peers.removePeer(privatePeers[val].id)
			})
		}
		if (publicPeers.length > this.maxPeers) {
			const peersToRemove = publicPeers.length - this.maxPeers
			const rand = getRandomUniqueNumbers(0, publicPeers.length, peersToRemove)
			rand.forEach((val) => {
				peers.removePeer(publicPeers[val].id)
			})
		} else if (publicPeers.length < this.maxPeers) {
			// Discover and connect to more peers if possible
			this.sendMessage({ type: 'REQUEST_PEERS' })
		}
	}

	private handlePeerList() {
		this.event.addEventListener('peerMessage', async (e) => {
			const pe = e as PeerMessageEvent
			const msg = pe.detail.data
			if (msg.type === 'PEER_LIST') {
				for (const val of msg.data.message.peers) {
					// Don't connect to yourself
					if (val === `${this.myIP}:${this.port}`) {
						continue
					}
					const pubPeers = peers.getPublicPeers()
					if (pubPeers.length >= this.maxPeers) {
						return
					}
					let includes = false
					for (let i = 0; i < pubPeers.length; i++) {
						if (pubPeers[i].address === val) {
							includes = true
							break
						}
					}
					if (!includes) {
						console.log('Connecting to discovered peer:', val)
						this.connectToPeer(val)
						// Sleep a bit before connecting to new peers
						// Seems like a good idea
						await sleep(500)
					}
				}
			} else if (msg.type === 'REQUEST_PEERS') {
				const pubPeers = peers.getPublicPeers()
				if (pubPeers.length === 0) {
					return
				}
				const addresses: string[] = []
				pubPeers.forEach((val) => {
					addresses.push(val.address)
				})
				const ws = peers.getWS(pe.detail.sender)
				if (!ws) {
					return
				}
				this.wsSend(ws, {
					type: 'PEER_LIST',
					data: {
						message: {
							peers: addresses,
						},
					},
				})
			}
		})
	}
}

// AI generated function - seems to work fine
/** Select a certain amount of unique numbers randomly from a range */
function getRandomUniqueNumbers(
	start: number,
	end: number,
	count: number,
): number[] {
	const range = Array.from({ length: end - start + 1 }, (_, i) => i + start)
	for (let i = range.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[range[i], range[j]] = [range[j], range[i]]
	}
	return range.slice(0, count)
}
