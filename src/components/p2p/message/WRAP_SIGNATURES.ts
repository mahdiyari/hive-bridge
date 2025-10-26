import { ChainType, SignaturesMessage } from '../helpers/types'
import { pendingWraps } from '../../PendingWraps'
import { p2pNetwork } from '../P2PNetwork'
import { WebSocket } from 'ws'

interface WrapInfo {
  type: ChainType
  msgHash: string
  operators?: string[]
  signatures?: string[]
}
/** Send wrap signatures to all/single peers - Send all if no operators and signatures provided */
export const WRAP_SIGNATURES = (wrapInfo: WrapInfo, ws?: WebSocket) => {
  const { msgHash, operators, signatures, type } = wrapInfo
  const wrap = pendingWraps.getWrapByHash(msgHash)
  if (!wrap) {
    return
  }
  const message: SignaturesMessage = {
    type: 'WRAP_SIGNATURES',
    data: {
      type,
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
}
