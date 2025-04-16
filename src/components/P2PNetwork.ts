import { randomUUID } from 'node:crypto'
import * as uuid from '@std/uuid'
import { messageChecksum } from '../helpers/message_checksum.ts'
import { getMyIp } from '../helpers/get_my_ip.ts'
import { checkPeerStatus } from '../helpers/check_peer_status.ts'
import { messageHash } from '../helpers/message_hash.ts'
import { isIPv4, isIPv6 } from 'node:net'
import {
	EventDetail,
	FullHelloAckMessage,
	FullHelloMessage,
	FullMessage,
	HelloAckMessage,
	HelloMessage,
	Message,
	Peer,
	PeerMessageEvent,
} from '../helpers/p2p/types.ts'
import { p2pMessages, pendingWraps } from './PendingHiveWraps.ts'
// import { generate } from 'selfsigned'

export class P2PNetwork {
	public peers: Map<string, Peer> = new Map()
	private knownPeers: string[] = []
	private connectionLimits = 10
	private messageRateLimit = 10 // per second
	private messagesInLastSecond: Map<string, number> = new Map()
	private port: number
	/** Randomly generated uuidv4 */
	private myId: string
	/** It will be automatically saved as ipv4 or [ipv6] */
	private myIP: string = 'none'
	private event = new EventTarget()

	constructor(knownPeers: string[], port: number) {
		this.knownPeers = knownPeers
		this.port = port
		this.myId = randomUUID()
		this.startServer().then(() => {
			this.discoverPeers()
		})
		// Use this to rate limit messages received
		setInterval(() => {
			this.messagesInLastSecond.clear()
		}, 1_000)
	}

	/** Receive messages from the P2P network */
	public onMessage(cb: (detail: EventDetail) => void) {
		this.event.addEventListener('peerMessage', (e) => {
			const pe = e as PeerMessageEvent
			cb(pe.detail)
		})
	}

	/** Prepare and send the message to all peers */
	public sendMessage(message: Message) {
		for (const [_id, peer] of this.peers) {
			this.wsSend(peer.ws, message)
		}
	}

	/** Send the signature to all peers */
	public sendSignature(operator: string, msgHash: string, signature: string) {
		const wrap = pendingWraps.getWrapByHash(msgHash)
		if (!wrap) {
			return
		}
		this.sendMessage({
			type: 'SIGNATURE',
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

		ws.onmessage = async (event) => {
			try {
				const message: FullHelloMessage = JSON.parse(event.data.toString())
				// Verify message integrity
				if (!messageChecksum(message)) {
					ws.close()
					return
				}
				// If not handshaked and the first message is not hello, close
				if (!successHandshake && message.type !== 'HELLO') {
					ws.close()
					return
				}
				// First message must be type HELLO
				if (message.type === 'HELLO') {
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
						this.wsSend(ws, ackMsg)
						return
					}
					// Require ip address in incoming handshake
					if (!message.data?.address) {
						ws.close()
						return
					}
					// Require valid uuid in incoming handshake
					const remoteId = message.data.peerId
					if (!uuid.validate(remoteId)) {
						ws.close()
						return
					}
					// Don't connect to yourself
					if (remoteId === this.myId) {
						ws.close()
						return
					}
					// Detect duplicate peers
					if (this.peers.has(remoteId)) {
						ws.close()
						return
					}
					// Check the public accessibility of the target peer
					const validAddress = await checkPeerStatus(message.data.address)
					const peer: Peer = {
						id: remoteId,
						ws,
						address: validAddress ? message.data.address : 'none',
					}
					this.addPeer(peer)
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
						this.removePeer(peer)
					}
					ws.onerror = () => {
						console.error(`WebSocket error:`, remoteId)
						this.removePeer(peer)
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
	private wsSend = (ws: WebSocket, msg: object) => {
		if (ws.readyState === WebSocket.OPEN) {
			const timestamp = Date.now()
			const hash = messageHash(JSON.stringify({ ...msg, timestamp }))
			ws.send(JSON.stringify({ ...msg, timestamp, hash }))
		} else {
			console.log(`ws connection is not open... removing the peer.`)
			ws.close()
		}
	}

	private addPeer = (peer: Peer) => {
		this.peers.set(peer.id, peer)
		console.log(`Peer added: ${peer.id}`)
	}

	private removePeer = (peer: Peer) => {
		this.peers.delete(peer.id)
		console.log(`Peer removed: ${peer.id}`)
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
			if (p2pMessages.has(parsedMessage.hash)) {
				return
			}
			p2pMessages.set(parsedMessage.hash, parsedMessage)
			const messageEvent = new CustomEvent('peerMessage', {
				detail: <EventDetail> {
					type: 'peerMessage',
					data: parsedMessage,
					sender: peerId,
				},
			})
			this.event.dispatchEvent(messageEvent)
			this.broadcast(message, peerId)
		} catch {
			// Remove the peer on malformed message
			ws.close()
		}
	}

	/** Repeat message to other peers */
	private broadcast(message: string, senderId: string) {
		for (const [id, peer] of this.peers) {
			if (id !== senderId) {
				try {
					peer.ws.send(message)
				} catch (error) {
					console.error(`Error sending message to peer ${id}: ${error}`)
				}
			}
		}
	}

	/** Add peers that are in knownPeers list */
	private discoverPeers() {
		for (const peerAddress of this.knownPeers) {
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
						// Duplicate peer
						if (this.peers.has(message.data.peerId)) {
							ws.close()
							return
						}
						const peer = {
							address: peerAddress,
							id: message.data.peerId,
							ws,
						}
						this.addPeer(peer)
						successHandshake = true
						// Re-assign the onmessage
						ws.onmessage = async (event2) => {
							await this.handleRegularMessage(
								event2.data.toString(),
								message.data.peerId,
								ws,
							)
						}
						ws.onclose = () => {
							this.removePeer(peer)
						}
						ws.onerror = () => {
							this.removePeer(peer)
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
	}

	private sendPeerList(peerId: string) {
		const peer = this.peers.get(peerId)
		if (peer) {
			if (peer.ws.readyState === WebSocket.OPEN) {
				const peersList = Array.from(this.peers.keys())
				peer.ws.send(JSON.stringify({ type: 'peerList', peers: peersList }))
			} else {
				console.warn(
					`WebSocket for peer ${peerId} is not open, skipping peer list send.`,
				)
			}
		} else {
			console.warn(`Peer ${peerId} does not exist, skipping peer list send.`)
		}
	}
	private handlePeerList(peers: string[], senderId: string) {
		for (const peerId of peers) {
			if (
				!this.peers.has(peerId) &&
				peerId !==
					[...this.peers.keys()].find((id) =>
						this.peers.get(id)?.ws === this.peers.get(senderId)?.ws
					)
			) {
				console.log(`New peer discovered from ${senderId}: ${peerId}`)
			}
		}
	}
}
