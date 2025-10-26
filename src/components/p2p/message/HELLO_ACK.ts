import { HelloAckMessage } from '../helpers/types'
import { p2pNetwork } from '../P2PNetwork'
import { WebSocket } from 'ws'

/** Send HELLO_ACK to ws */
export const HELLO_ACK = (ws: WebSocket, myId: string) => {
  const ackMsg: HelloAckMessage = {
    type: 'HELLO_ACK',
    data: {
      peerId: myId,
    },
  }
  p2pNetwork.wsSend(ws, ackMsg)
}
