import { config } from '@/config'
import { sha256String } from '@/utils/p2p.utils'
import { PrivateKey } from 'hive-tx'
import { p2pNetwork } from './P2PNetwork'
import {
  HelloAckMessage,
  HelloMessage,
  HiveSignaturesMessage,
  SignaturesMessage,
} from '@/types/network.types'
import { WebSocket } from 'ws'
import { pendingUnwraps } from '@/Unwraps'
import { ChainName } from '@/types/chain.types'
import { pendingWraps } from '@/Wraps'

export const messageList = {
  /** The first message to send for handshake */
  HELLO: (ws: WebSocket, myId: string, myIP: string, port: number) => {
    const helloMsg: HelloMessage = {
      type: 'HELLO',
      data: {
        peerId: myId,
        address: `${myIP}:${port}`,
      },
    }
    p2pNetwork.wsSend(ws, helloMsg)
  },
  /** Response to HELLO to finish handshake */
  HELLO_ACK: (ws: WebSocket, myId: string) => {
    const ackMsg: HelloAckMessage = {
      type: 'HELLO_ACK',
      data: {
        peerId: myId,
      },
    }
    p2pNetwork.wsSend(ws, ackMsg)
  },
  /** Regular heartbeat broadcasted by operators */
  HEARTBEAT: (myId: string) => {
    const USERNAME = config.hive.operator.username
    const ACTIVE_KEY = config.hive.operator.activeKey
    if (!USERNAME || !ACTIVE_KEY) {
      return
    }
    const msg = {
      operator: USERNAME,
      peerId: myId,
      timestamp: Date.now(),
    }
    const signature = signHeartbeat(msg, PrivateKey.from(ACTIVE_KEY))
    p2pNetwork.sendMessage({
      type: 'HEARTBEAT',
      data: {
        ...msg,
        signature,
      },
    })
  },

  /** Ask for signatures for an unwrap */
  REQUEST_HIVE_SIGNATURES: (trxHash: string) => {
    p2pNetwork.sendMessage({
      type: 'REQUEST_HIVE_SIGNATURES',
      data: {
        trxHash,
      },
    })
  },
  /** Send signatures of an unwrap to all peers or to just provided peer */
  HIVE_SIGNATURES: (unwrapInfo: UnwrapInfo, ws?: WebSocket) => {
    const { trxHash, operators, signatures } = unwrapInfo
    const unwrap = pendingUnwraps.getUnwrap(trxHash)
    if (!unwrap || !unwrap.trx.transaction) {
      return
    }
    const message: HiveSignaturesMessage = {
      type: 'HIVE_SIGNATURES',
      data: {
        trxHash,
        operators: operators ? operators : unwrap.operators,
        signatures: signatures ? signatures : unwrap.trx.transaction.signatures,
      },
    }
    if (ws) {
      p2pNetwork.wsSend(ws, message)
    } else {
      p2pNetwork.sendMessage(message)
    }
  },

  /** Ask for more peer addresses */
  REQUEST_PEERS: () => {
    p2pNetwork.sendMessage({ type: 'REQUEST_PEERS' })
  },
  /** Share our peer list with other peers who asked for it */
  PEER_LIST: (ws: WebSocket, addresses: string[]) => {
    p2pNetwork.wsSend(ws, {
      type: 'PEER_LIST',
      data: {
        peers: addresses,
      },
    })
  },

  /** Ask for signatures for a wrap */
  REQUEST_WRAP_SIGNATURES: (msgHash: string) => {
    p2pNetwork.sendMessage({
      type: 'REQUEST_WRAP_SIGNATURES',
      data: {
        msgHash,
      },
    })
  },
  /** Share signatures with one or more peers */
  WRAP_SIGNATURES: (wrapInfo: WrapInfo, ws?: WebSocket) => {
    const { msgHash, operators, signatures, chainName } = wrapInfo
    const wrap = pendingWraps.getWrapByHash(msgHash)
    if (!wrap) {
      return
    }
    const message: SignaturesMessage = {
      type: 'WRAP_SIGNATURES',
      data: {
        chainName,
        msgHash,
        operators: operators ? operators : wrap.operators,
        signatures: signatures ? signatures : wrap.signatures,
      },
    }
    if (ws) {
      p2pNetwork.wsSend(ws, message)
    } else {
      p2pNetwork.sendMessage(message)
    }
  },
}

interface WrapInfo {
  chainName: ChainName
  msgHash: string
  operators?: string[]
  signatures?: string[]
}

interface UnwrapInfo {
  trxHash: string
  operators?: string[]
  signatures?: string[]
}

interface Heartbeat {
  operator: string
  peerId: string
  timestamp: number
}
interface SignedHeartbeat extends Heartbeat {
  signature: string
}

/** Operators need to sign the heartbeat msg */
const signHeartbeat = (msg: Heartbeat, key: PrivateKey) => {
  const hash = <Uint8Array>sha256String(JSON.stringify(msg), false)
  return key.sign(hash).customToString()
}
