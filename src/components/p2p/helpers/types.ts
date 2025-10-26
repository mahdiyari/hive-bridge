import { WebSocket } from 'ws'

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

export interface SignaturesMessage {
  type: 'WRAP_SIGNATURES'
  data: {
    type: ChainType
    msgHash: string
    operators: string[]
    signatures: string[]
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

export interface HiveSignaturesMessage {
  type: 'HIVE_SIGNATURES'
  data: {
    trxHash: string
    operators: string[]
    signatures: string[]
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

export interface RequestWrapSignatures {
  type: 'REQUEST_WRAP_SIGNATURES'
  data: {
    msgHash: string
  }
}

export interface RequestHiveSignatures {
  type: 'REQUEST_HIVE_SIGNATURES'
  data: {
    trxHash: string
  }
}

export type Message =
  | HelloMessage
  | HelloAckMessage
  | SignaturesMessage
  | HeartbeatMessage
  | HiveSignaturesMessage
  | PeerListMessage
  | RequestPeersMessage
  | RequestWrapSignatures
  | RequestHiveSignatures

export type FullMessage = Message & { timestamp: number; hash: string }

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

// Name of the chains
export type ChainType = 'ETH'
