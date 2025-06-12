export interface Peer {
	id: string
	ws: WebSocket
	address: string | 'none'
	operator: string | 'none'
}

export interface HelloMessage {
	type: 'HELLO'
	data: {
		peerId: string
		address: string
	}
}

export interface HelloAckMessage {
	type: 'HELLO_ACK'
	data: {
		peerId: string
	}
}

export interface SignatureMessage {
	type: 'ETH_SIGNATURE'
	data: {
		message: {
			address: `0x${string}`
			amount: bigint
			blockNum: number
			contract: `0x${string}`
		}
		operator: string
		signature: `0x${string}`
	}
}

export interface HeartbeatMessage {
	type: 'HEARTBEAT'
	data: {
		operator: string
		peerId: string
		// headBlock: number
		timestamp: number
		signature: string
	}
}

export interface HiveSignatureMessage {
	type: 'HIVE_SIGNATURE'
	data: {
		message: {
			ethTransactionHash: string
			digest: string
		}
		operator: string
		signature: string
	}
}

export interface PeerListMessage {
	type: 'PEER_LIST'
	data: {
		peers: string[]
	}
}

export interface RequestPeersMessage {
	type: 'REQUEST_PEERS'
}

export interface FullHelloMessage extends HelloMessage {
	timestamp: number
	hash: string
}
export interface FullHelloAckMessage extends HelloAckMessage {
	timestamp: number
	hash: string
}
export interface FullSignatureMessage extends SignatureMessage {
	timestamp: number
	hash: string
}
export interface FullHeartbeatMessage extends HeartbeatMessage {
	timestamp: number
	hash: string
}
export interface FullHiveSignatureMessage extends HiveSignatureMessage {
	timestamp: number
	hash: string
}
export interface FullPeerListMessage extends PeerListMessage {
	timestamp: number
	hash: string
}
export interface FullRequestPeersMessage extends RequestPeersMessage {
	timestamp: number
	hash: string
}

export type Message =
	| HelloMessage
	| HelloAckMessage
	| SignatureMessage
	| HeartbeatMessage
	| HiveSignatureMessage
	| PeerListMessage
	| RequestPeersMessage

export type FullMessage =
	| FullHelloMessage
	| FullHelloAckMessage
	| FullSignatureMessage
	| FullHeartbeatMessage
	| FullHiveSignatureMessage
	| FullPeerListMessage
	| FullRequestPeersMessage

// Create a custom event for redirecting the peer messages to the main app
// All peers will dispatch this event onmessage
export type EventDetail = {
	type: string
	data: FullMessage
	sender: string
}
export interface PeerMessageEvent extends CustomEvent {
	detail: EventDetail
}
