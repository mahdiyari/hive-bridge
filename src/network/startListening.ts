import { bytesToHex } from '@noble/hashes/utils.js'
import { pendingUnwraps } from '../Unwraps'
import { p2pNetwork } from './P2PNetwork'
import { pendingWraps } from '../Wraps'
import { peers } from './Peers'
import { operators } from './Operators'
import { messageList } from './messageList'
import { sha256String } from '@/utils/p2p.utils'
import { Signature } from 'hive-tx'
import { config } from '@/config'

export const startListening = () => {
  p2pNetwork.onMessage(async (msg) => {
    const type = msg.data.type
    if (type === 'HEARTBEAT') {
      const data = msg.data.data
      const valid = await validateHeartbeat(data)
      if (valid) {
        // if heartbeat sender is the operator, set the operator name for that peer
        // peers.receivedHeartbeat(data.peerId, data.operator)
        operators.get(data.operator)?.updateLastSeen()
      }
    }
    if (type === 'HIVE_SIGNATURES') {
      // Received a Hive signature from peers for pendingUnwraps
      const data = msg.data.data
      // Verify and add the signature
      if (data.operators.length !== data.signatures.length) {
        return
      }
      for (let i = 0; i < data.operators.length; i++) {
        pendingUnwraps.addSignature(
          data.operators[i],
          data.trxHash,
          data.signatures[i]
        )
      }
    }
    if (type === 'REQUEST_HIVE_SIGNATURES') {
      const trxHash = msg.data.data.trxHash
      const unwrap = pendingUnwraps.getUnwrap(trxHash)
      if (!unwrap) {
        return
      }
      const digest = bytesToHex(unwrap.trx.digest().digest)
      const ws = peers.getWS(msg.sender)
      if (ws) {
        messageList.HIVE_SIGNATURES({ trxHash }, ws)
      }
    }
    if (type === 'REQUEST_WRAP_SIGNATURES') {
      const msgHash = msg.data.data.msgHash
      const allWraps = pendingWraps.getAllPendingWraps()
      for (const [key, value] of allWraps) {
        if (key === msgHash) {
          const ws = peers.getWS(msg.sender)
          if (ws) {
            messageList.WRAP_SIGNATURES(
              { chainName: value.data.chainName, msgHash },
              ws
            )
          }
        }
      }
    }
    if (type === 'WRAP_SIGNATURES') {
      // Received ETH signatures from peers for pendingWraps
      const data = msg.data.data
      // validate and add signatures
      const { operators, signatures, msgHash } = data
      if (operators.length !== signatures.length) {
        return
      }
      for (let i = 0; i < signatures.length; i++) {
        await pendingWraps.addSignature(msgHash, signatures[i], operators[i])
      }
    }
  })
}

interface Heartbeat {
  operator: string
  peerId: string
  timestamp: number
}
interface SignedHeartbeat extends Heartbeat {
  signature: string
}

const validateHeartbeat = async (msg: SignedHeartbeat) => {
  try {
    // Reject older than 8s messages
    if (Date.now() - msg.timestamp > config.network.message.maxAgeMs) {
      return false
    }
    const operator = operators.get(msg.operator)
    if (!operator) {
      return false
    }
    const signature = Signature.from(msg.signature)
    const rawMsg: Heartbeat = {
      operator: msg.operator,
      peerId: msg.peerId,
      timestamp: msg.timestamp,
    }
    const hash = <Uint8Array>sha256String(JSON.stringify(rawMsg), false)
    const recoveredKey = signature.getPublicKey(hash).toString()
    const opKey = operator.publicKey
    if (!opKey) {
      return false
    }
    if (opKey === recoveredKey) {
      return true
    }
    return false
  } catch {
    return false
  }
}
