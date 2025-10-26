import { bytesToHex } from '@noble/hashes/utils.js'
import { operators } from '../Operators'
import { peers } from '../Peers'
import { pendingUnwraps } from '../PendingUnwraps'
import { validateHeartbeat } from './message/HEARTBEAT'
import { p2pNetwork } from './P2PNetwork'
import { HIVE_SIGNATURES } from './message/HIVE_SIGNATURES'
import { WRAP_SIGNATURES } from './message/WRAP_SIGNATURES'
import { pendingWraps } from '../PendingWraps'

export const startListening = () => {
  p2pNetwork.onMessage(async (msg) => {
    const type = msg.data.type
    if (type === 'HEARTBEAT') {
      const data = msg.data.data
      const valid = await validateHeartbeat(data)
      if (valid) {
        // if heartbeat sender is the operator, set the operator name for that peer
        peers.receivedHeartbeat(data.peerId, data.operator)
        operators.setOperatorLastSeen(data.operator, Date.now())
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
        HIVE_SIGNATURES({ trxHash }, ws)
      }
    }
    if (type === 'REQUEST_WRAP_SIGNATURES') {
      const msgHash = msg.data.data.msgHash
      const allWraps = pendingWraps.getAllPendingWraps()
      for (const [key, value] of allWraps) {
        if (key === msgHash) {
          const ws = peers.getWS(msg.sender)
          if (ws) {
            WRAP_SIGNATURES({ type: value.data.type, msgHash }, ws)
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
