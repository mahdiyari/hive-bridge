import { p2pNetwork } from '../P2PNetwork'

export const REQUEST_HIVE_SIGNATURES = (trxHash: string) => {
  p2pNetwork.sendMessage({
    type: 'REQUEST_HIVE_SIGNATURES',
    data: {
      trxHash,
    },
  })
}
