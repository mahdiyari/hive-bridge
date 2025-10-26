import { p2pNetwork } from '../P2PNetwork'

export const REQUEST_PEERS = () => {
  p2pNetwork.sendMessage({ type: 'REQUEST_PEERS' })
}
