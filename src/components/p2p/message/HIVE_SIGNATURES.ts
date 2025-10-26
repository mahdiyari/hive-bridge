import { pendingUnwraps } from '../../PendingUnwraps'
import { HiveSignaturesMessage } from '../helpers/types'
import { p2pNetwork } from '../P2PNetwork'
import { WebSocket } from 'ws'

interface UnwrapInfo {
  trxHash: string
  operators?: string[]
  signatures?: string[]
}

export const HIVE_SIGNATURES = (unwrapInfo: UnwrapInfo, ws?: WebSocket) => {
  const { trxHash, operators, signatures } = unwrapInfo
  const unwrap = pendingUnwraps.getUnwrap(trxHash)
  if (!unwrap || !unwrap.trx.signedTransaction) {
    return
  }
  const message: HiveSignaturesMessage = {
    type: 'HIVE_SIGNATURES',
    data: {
      trxHash,
      operators: operators ? operators : unwrap.operators,
      signatures: signatures
        ? signatures
        : unwrap.trx.signedTransaction.signatures,
    },
  }
  if (ws) {
    p2pNetwork.wsSend(ws, message)
  } else {
    p2pNetwork.sendMessage(message)
  }
}
