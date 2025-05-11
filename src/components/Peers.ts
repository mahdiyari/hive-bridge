import { checkPeerStatus } from '../helpers/p2p/check_peer_status.ts'
import { FullMessage, Peer } from '../helpers/p2p/types.ts'

class Peers {
	private DISCONNECT_TIME = 100_000 // 100s
	private MESSAGE_LIFESPAN = 10_000 // 10s
	private peers: Map<string, Peer> = new Map()
	private messages: Map<string, FullMessage> = new Map()

	constructor() {
		setInterval(() => {
			// Remove peers that are not seen recently - Maybe not - ws should handle it?
			// this.peers.forEach((value, key) => {
			// 	if (Date.now() - value.lastSeen > this.DISCONNECT_TIME) {
			// 		this.removePeer(key)
			// 	}
			// })
			// Remove older messages
			this.messages.forEach((value, key) => {
				if (Date.now() - value.timestamp > this.MESSAGE_LIFESPAN) {
					this.messages.delete(key)
				}
			})
		}, 5_000)
	}

	public getWS(id: string) {
		return this.peers.get(id)?.ws
	}

	public async addPeer(
		id: string,
		ws: WebSocket,
		address: string,
		operator: string,
	) {
		const peer = this.peers.get(id)
		if (peer) {
			// We are already connected to this peer so close the new connection
			return ws.close()
		}
		// Check the public accessibility of the target peer
		const validAddress = await checkPeerStatus(address)
		this.peers.set(id, {
			id,
			ws,
			address: validAddress ? address : 'none',
			operator,
		})
	}

	public removePeer(id: string) {
		if (!id) {
			return
		}
		try {
			const peer = this.peers.get(id)
			peer?.ws.close()
		} catch {
			// The connection might been already closed
		} finally {
			console.warn('Removed peer', this.peers.get(id))
			this.peers.delete(id)
		}
	}

	/** Peers that belong to operators */
	public getOperatorPeers() {
		const temp: Peer[] = []
		this.peers.forEach((value) => {
			if (value.operator !== 'none') {
				temp.push(value)
			}
		})
		return temp
	}

	/** Peers that are publicly accessible from the internet */
	public getPublicPeers() {
		const temp: Peer[] = []
		this.peers.forEach((value) => {
			if (value.address !== 'none') {
				temp.push(value)
			}
		})
		return temp
	}

	/** Peers that are not accessible from the internet */
	public getPrivatePeers() {
		const temp: Peer[] = []
		this.peers.forEach((value) => {
			if (value.address === 'none') {
				temp.push(value)
			}
		})
		return temp
	}

	/** All connected peers */
	public getAllPeers() {
		const temp: Peer[] = []
		this.peers.forEach((value) => {
			temp.push(value)
		})
		return temp
	}

	/** Update lastSeen and operator name of the peer sending heartbeat if we are connected */
	public receivedHeartbeat(id: string, operator: string) {
		const peer = this.peers.get(id)
		if (peer) {
			peer.operator = operator
		}
	}

	public messageSeen(hash: string) {
		return this.messages.has(hash)
	}

	public addMessage(hash: string, message: FullMessage) {
		this.messages.set(hash, message)
	}
}

export const peers = new Peers()
