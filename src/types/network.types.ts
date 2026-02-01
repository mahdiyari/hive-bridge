import { ChainName } from './chain.types'
import { ProposalKey } from './governance.types'

export interface HelloMessage {
  type: 'HELLO'
  data: {
    peerId: string
    port: number
  }
  private: true
}

export interface HelloAckMessage {
  type: 'HELLO_ACK'
  data: {
    peerId: string
    remoteId: string
  }
  private: true
}

export interface SignaturesMessage {
  type: 'WRAP_SIGNATURES'
  data: {
    chainName: ChainName
    msgHash: string
    operators: string[]
    signatures: string[]
  }
  private: boolean
}

export interface HiveSignaturesMessage {
  type: 'HIVE_SIGNATURES'
  data: {
    trxHash: string
    operators: string[]
    signatures: string[]
  }
  private: boolean
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
  private: false
}

export interface PeerListMessage {
  type: 'PEER_LIST'
  data: {
    peers: string[]
  }
  private: true
}

export interface RequestPeersMessage {
  type: 'REQUEST_PEERS'
  private: true
}

export interface RequestWrapSignatures {
  type: 'REQUEST_WRAP_SIGNATURES'
  data: {
    msgHash: string
  }
  private: true
}

export interface RequestHiveSignatures {
  type: 'REQUEST_HIVE_SIGNATURES'
  data: {
    trxHash: string
  }
  private: true
}

export interface GovernanceMessage {
  type: 'GOVERNANCE'
  data: {
    proposalKey: ProposalKey
    operator: string
    signature: string
  }
  private: boolean
}

export interface RequestGovernanceMessage {
  type: 'REQUEST_GOVERNANCE'
  data: {
    proposalKey: ProposalKey
  }
  private: true
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
  | GovernanceMessage
  | RequestGovernanceMessage

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
