import { Signature } from 'hive-tx'
import { operators } from '../Operators'
import { sha256String } from '@/utils/p2p.utils'

interface Heartbeat {
  operator: string
  peerId: string
  timestamp: number
}
interface SignedHeartbeat extends Heartbeat {
  signature: string
}

export const validateHeartbeat = async (msg: SignedHeartbeat) => {
  try {
    // Reject older than 10s messages
    if (Date.now() - msg.timestamp > 10_000) {
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
