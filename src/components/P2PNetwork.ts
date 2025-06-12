import { randomUUID } from 'node:crypto'
import * as uuid from '@std/uuid'
import { messageChecksum } from '../helpers/p2p/message_checksum.ts'
import { getMyIp } from '../helpers/general/get_my_ip.ts'
import { messageHash } from '../helpers/p2p/message_hash.ts'
import { isIPv4, isIPv6 } from 'node:net'
import {
	EventDetail,
	FullMessage,
	HelloAckMessage,
	HelloMessage,
	Message,
	PeerMessageEvent,
} from '../helpers/p2p/types.ts'
import { pendingWraps } from './PendingWraps.ts'
import { pendingUnwraps } from './PendingUnwraps.ts'
import { signHeartbeat, validateHeartbeat } from '../helpers/p2p/heartbeat.ts'
import { PrivateKey } from 'hive-tx'
import { peers } from './Peers.ts'
import { operators } from './Operators.ts'
import { sleep } from '../helpers/general/sleep.ts'
import { bytesToHex } from '@wevm/viem/utils'
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

	constructor() {
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
			this.connectToKnownPeers()
			this.checkPeers()
		}, 60_000)
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
					digest: bytesToHex(digest).slice(2),
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
					return this.handleIncomingConnection(socket, response)
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
	private handleIncomingConnection(ws: WebSocket, response: Response) {
		let remoteId: string | undefined
		// timeout after 5 seconds if not handshaked
		setTimeout(() => {
			if (!remoteId) {
				ws.close()
			}
		}, 5_000)

		ws.onmessage = (event) => {
			const message = this.parseMessage(event.data.toString())
			if (!message) {
				return ws.close()
			}
			// If not handshaked and the first message is not hello, close
			if (!remoteId && message.type !== 'HELLO') {
				return ws.close()
			}
			// First message must be type HELLO
			if (!remoteId && message.type === 'HELLO') {
				// Experimental: Don't accept connections if we are at the peers limit
				// Might want to send list of our peers so they can connect instead?
				if (peers.getAllPeers().length >= this.maxPeers * 2) {
					// TODO: send peer list perhaps
					return ws.close()
				}
				// Require ip address in incoming handshake
				if (!message.data?.address) {
					return ws.close()
				}
				// Require valid uuid in incoming handshake
				remoteId = message.data.peerId
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
			} else if (remoteId && peers.getWS(remoteId)) {
				return this.handleRegularMessage(
					message,
					remoteId,
					ws,
				)
			} else {
				return ws.close()
			}
		}
		ws.onclose = () => {
			if (remoteId && peers.getWS(remoteId)) {
				peers.removePeer(remoteId)
			}
		}
		ws.onerror = () => {
			console.error(`WebSocket error:`, remoteId)
			// onclose will be called after this
		}
		return response
	}

	/** Add timestamp and hash the message before sending to ws */
	private wsSend = (ws: WebSocket, msg: Message | FullMessage) => {
		if (ws.readyState === WebSocket.OPEN) {
			if ('hash' in msg) {
				// The message is already FullMessage and is a repeat
				peers.addMessage(msg.hash, msg)
				return ws.send(JSON.stringify(msg))
			}
			const timestamp = Date.now()
			const hash = messageHash(JSON.stringify({ ...msg, timestamp }))
			const fullMessage = { ...msg, timestamp, hash }
			// Add message to the seen list
			// so we don't broadcast it again when received from other peers
			peers.addMessage(hash, fullMessage)
			const encodedMsg = JSON.stringify(fullMessage)
			ws.send(encodedMsg)
		} else {
			console.log(`ws connection is not open... removing the peer.`)
			ws.close()
		}
	}

	/** Regular messages after the initial handshake will be handled here */
	private handleRegularMessage(
		message: FullMessage,
		peerId: string,
		ws: WebSocket,
	) {
		const recentMessageCount = this.messagesInLastSecond.get(peerId) || 0
		if (recentMessageCount > this.messageRateLimit) {
			console.warn(`Rate limit exceeded for peer: ${peerId}`)
			return
		}
		this.messagesInLastSecond.set(peerId, recentMessageCount + 1)

		try {
			// If we have already seen this message, ignore it
			if (peers.messageSeen(message.hash)) {
				console.warn('aleady seen this message', message)
				return
			}
			peers.addMessage(message.hash, message)
			const messageEvent = new CustomEvent('peerMessage', {
				detail: <EventDetail> {
					type: 'peerMessage',
					data: message,
					sender: peerId,
				},
			})
			this.event.dispatchEvent(messageEvent)
			// Repeat to other peers if not personal communication
			if (
				message.type !== 'HELLO' &&
				message.type !== 'HELLO_ACK' &&
				message.type !== 'REQUEST_PEERS' &&
				message.type !== 'PEER_LIST'
			) {
				this.sendMessage(message, peerId)
			}
		} catch {
			console.warn('malformed message from', peerId)
			// Remove the peer on malformed message?
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
			let remoteId: string | undefined
			// skip already connected peers
			const publicPeers = peers.getPublicPeers()
			for (const peer of publicPeers) {
				if (peer.address === peerAddress) {
					return
				}
			}
			const ws = new WebSocket(`ws://${peerAddress}`)

			// Send HELLO onOpen
			ws.onopen = () => {
				// Close the connection after 5s if not handshaked
				setTimeout(() => {
					if (!remoteId) {
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
				const message = this.parseMessage(event.data.toString())
				if (!message) {
					return ws.close()
				}
				// Any message other than HELLO_ACK is invalid before handshake
				if (!remoteId && message.type !== 'HELLO_ACK') {
					return ws.close()
				}
				if (!remoteId && message.type === 'HELLO_ACK') {
					if (!uuid.validate(message.data.peerId)) {
						ws.close()
						return
					}
					remoteId = message.data.peerId
					// Validate and add new peer
					peers.addPeer(
						remoteId,
						ws,
						peerAddress,
						'none',
					)
				} else if (remoteId && peers.getWS(remoteId)) {
					return this.handleRegularMessage(
						message,
						remoteId,
						ws,
					)
				} else {
					return ws.close()
				}
			}
			ws.onclose = () => {
				if (remoteId) {
					peers.removePeer(remoteId)
				}
			}
			ws.onerror = () => {
				console.error(
					`Error connecting to known peer ${peerAddress}`,
				)
				// onclose will run afterwards
			}
		} catch {
			console.error(
				`Failed to connect to known peer ${peerAddress}`,
			)
		}
	}

	private parseMessage = (message: string) => {
		let parsedMessage: FullMessage
		try {
			parsedMessage = <FullMessage> JSON.parse(message)
		} catch {
			return null
		}
		const checksum = messageChecksum(parsedMessage)
		if (!checksum) {
			return null
		}
		return parsedMessage
	}

	// TODO: custom encoding of the message to lower network usage
	// private encodeMsg = (msg: FullMessage) => {
	// 	let encodedMsg = msg.hash + ';' + msg.timestamp + ';' + msg.type
	// 	switch (msg.type) {
	// 		case 'HELLO':
	// 			encodedMsg += ';' + msg.data.peerId + ';' + msg.data.address
	// 			break
	// 		case 'HELLO_ACK':
	// 			encodedMsg += ';' + msg.data.peerId
	// 			break
	// 		case 'PEER_LIST':
	// 			encodedMsg += ';' + msg.data.peers.join(',')
	// 			break
	// 		default:
	// 			break
	// 	}
	// }
	// private decodeMsg = (msg: string) => {}

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
				for (const val of msg.data.peers) {
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
						peers: addresses,
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
