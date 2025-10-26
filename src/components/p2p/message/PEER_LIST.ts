import { WebSocket } from 'ws'
import { p2pNetwork } from '../P2PNetwork'

export const PEER_LIST = (ws: WebSocket, addresses: string[]) => {
  p2pNetwork.wsSend(ws, {
    type: 'PEER_LIST',
    data: {
      peers: addresses,
    },
  })
}
