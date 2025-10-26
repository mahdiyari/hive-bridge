import { PrivateKey, Signature } from 'hive-tx'
import { sha256String } from '../helpers/message_hash'
import { operators } from '../../Operators'
import { p2pNetwork } from '../P2PNetwork'

interface Heartbeat {
  operator: string
  peerId: string
  timestamp: number
}
interface SignedHeartbeat extends Heartbeat {
  signature: string
}

export const HEARTBEAT = (myId: string) => {
  const username = <string>process.env.USERNAME?.replaceAll('"', '')
  const activeKey = <string>process.env.ACTIVE_KEY?.replaceAll('"', '')
  const msg = {
    operator: username,
    peerId: myId,
    timestamp: Date.now(),
  }
  const signature = signHeartbeat(msg, PrivateKey.from(activeKey))
  p2pNetwork.sendMessage({
    type: 'HEARTBEAT',
    data: {
      ...msg,
      signature,
    },
  })
}

const signHeartbeat = (msg: Heartbeat, key: PrivateKey) => {
  const hash = <Uint8Array>sha256String(JSON.stringify(msg), false)
  return key.sign(hash).customToString()
}

export const validateHeartbeat = async (msg: SignedHeartbeat) => {
  try {
    // Reject older than 10s messages
    if (Date.now() - msg.timestamp > 10_000) {
      return false
    }
    if (!operators.getOperators().includes(msg.operator)) {
      return false
    }
    const signature = Signature.from(msg.signature)
    const rawMsg: Heartbeat = {
      operator: msg.operator,
      peerId: msg.peerId,
      timestamp: msg.timestamp,
    }
    const hash = sha256String(JSON.stringify(rawMsg))
    const recoveredKey = signature.getPublicKey(hash).toString()
    const opKeys = operators.getOperatorKeys(msg.operator)
    if (!opKeys || opKeys.length === 0) {
      return false
    }
    for (const key of opKeys) {
      if (key === recoveredKey) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}
