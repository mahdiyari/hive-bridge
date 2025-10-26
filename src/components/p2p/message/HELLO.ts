import { HelloMessage } from '../helpers/types'
import { p2pNetwork } from '../P2PNetwork'
import { WebSocket } from 'ws'

export const HELLO = (
  ws: WebSocket,
  myId: string,
  myIP: string,
  port: number
) => {
  const helloMsg: HelloMessage = {
    type: 'HELLO',
    data: {
      peerId: myId,
      address: `${myIP}:${port}`,
    },
  }
  p2pNetwork.wsSend(ws, helloMsg)
}
