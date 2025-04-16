export interface Peer {
	id: string
	ws: WebSocket
	address: string | 'none'
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
	type: 'SIGNATURE'
	data: {
		message: {
			address: string
			amount: number
			blockNum: number
			contract: string
		}
		operator: string
		signature: string
	}
}

export interface HeartbeatMessage {
	type: 'HEARTBEAT'
	data: {
		operator: string
		peerId: string
		headBlock: number
		timestamp: number
		signature: string
	}
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

export type Message =
	| HelloMessage
	| HelloAckMessage
	| SignatureMessage
	| HeartbeatMessage

export type FullMessage =
	| FullHelloMessage
	| FullHelloAckMessage
	| FullSignatureMessage
	| FullHeartbeatMessage

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
