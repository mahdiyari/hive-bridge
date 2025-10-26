import { p2pNetwork } from '../P2PNetwork'

export const REQUEST_WRAP_SIGNATURES = (msgHash: string) => {
  p2pNetwork.sendMessage({
    type: 'REQUEST_WRAP_SIGNATURES',
    data: {
      msgHash,
    },
  })
}
