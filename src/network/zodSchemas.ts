import { z } from 'zod'
import { chainNames } from '@/blockchain'
import { ProposalKey } from '@/types/governance.types'

// Message schemas
export const HelloMessageSchema = z.object({
  type: z.literal('HELLO'),
  data: z.object({
    peerId: z.uuidv4(),
    port: z.number().int().min(1).max(65535),
    version: z.string(),
  }),
  private: z.literal(true),
})

export const HelloAckMessageSchema = z.object({
  type: z.literal('HELLO_ACK'),
  data: z.object({
    peerId: z.uuidv4(),
    remoteId: z.uuidv4(),
    version: z.string(),
  }),
  private: z.literal(true),
})

export const SignaturesMessageSchema = z.object({
  type: z.literal('WRAP_SIGNATURES'),
  data: z.object({
    chainName: z.literal(chainNames),
    msgHash: z.string(),
    operators: z.array(z.string()).min(1).max(50),
    signatures: z.array(z.string()).min(1).max(50),
  }),
  private: z.boolean(),
})

export const HiveSignaturesMessageSchema = z.object({
  type: z.literal('HIVE_SIGNATURES'),
  data: z.object({
    trxHash: z.string(),
    operators: z.array(z.string().min(3).max(16)).min(1).max(50),
    signatures: z.array(z.string().length(130)).min(1).max(50),
  }),
  private: z.boolean(),
})

export const HeartbeatMessageSchema = z.object({
  type: z.literal('HEARTBEAT'),
  data: z.object({
    operator: z.string().min(3).max(16),
    peerId: z.uuidv4(),
    timestamp: z.int().positive(),
    signature: z.string().length(130),
  }),
  private: z.literal(false),
})

export const PeerListMessageSchema = z.object({
  type: z.literal('PEER_LIST'),
  data: z.object({
    peers: z.array(z.string()),
  }),
  private: z.literal(true),
})

export const RequestPeersMessageSchema = z.object({
  type: z.literal('REQUEST_PEERS'),
  private: z.literal(true),
})

export const RequestWrapSignaturesSchema = z.object({
  type: z.literal('REQUEST_WRAP_SIGNATURES'),
  data: z.object({
    msgHash: z.string(),
  }),
  private: z.literal(true),
})

export const RequestHiveSignaturesSchema = z.object({
  type: z.literal('REQUEST_HIVE_SIGNATURES'),
  data: z.object({
    trxHash: z.string(),
  }),
  private: z.literal(true),
})

export const GovernanceMessageSchema = z.object({
  type: z.literal('GOVERNANCE'),
  data: z.object({
    proposalKey: z.string<ProposalKey>(),
    operator: z.string().min(3).max(16),
    signature: z.string(),
  }),
  private: z.boolean(),
})

export const RequestGovernanceMessageSchema = z.object({
  type: z.literal('REQUEST_GOVERNANCE'),
  data: z.object({
    proposalKey: z.string<ProposalKey>(),
  }),
  private: z.literal(true),
})

// Union of all message schemas
export const MessageSchema = z.discriminatedUnion('type', [
  HelloMessageSchema,
  HelloAckMessageSchema,
  SignaturesMessageSchema,
  HiveSignaturesMessageSchema,
  HeartbeatMessageSchema,
  PeerListMessageSchema,
  RequestPeersMessageSchema,
  RequestWrapSignaturesSchema,
  RequestHiveSignaturesSchema,
  GovernanceMessageSchema,
  RequestGovernanceMessageSchema,
])

// Full message schema (with timestamp and hash)
export const FullMessageSchema = z.intersection(
  MessageSchema,
  z.object({
    timestamp: z.number().int(),
    hash: z.string().regex(/^[a-fA-F0-9]{16}$/),
  })
)

// Type inference
export type HelloMessage = z.infer<typeof HelloMessageSchema>
export type HelloAckMessage = z.infer<typeof HelloAckMessageSchema>
export type SignaturesMessage = z.infer<typeof SignaturesMessageSchema>
export type HiveSignaturesMessage = z.infer<typeof HiveSignaturesMessageSchema>
export type HeartbeatMessage = z.infer<typeof HeartbeatMessageSchema>
export type PeerListMessage = z.infer<typeof PeerListMessageSchema>
export type RequestPeersMessage = z.infer<typeof RequestPeersMessageSchema>
export type RequestWrapSignatures = z.infer<typeof RequestWrapSignaturesSchema>
export type RequestHiveSignatures = z.infer<typeof RequestHiveSignaturesSchema>
export type GovernanceMessage = z.infer<typeof GovernanceMessageSchema>
export type RequestGovernanceMessage = z.infer<
  typeof RequestGovernanceMessageSchema
>

export type Message = z.infer<typeof MessageSchema>
export type FullMessage = z.infer<typeof FullMessageSchema>
