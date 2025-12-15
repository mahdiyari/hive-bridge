import { peers } from './Peers'
import { messageList } from './messageList'
import { logger } from '@/utils/logger'
import { sleep } from '@/utils/sleep'

export class PeerDiscovery {
  constructor(
    private myAddress: () => string,
    private maxPeers: number,
    private peerDiscoverySleepMs: number,
    private connectToPeer: (address: string) => void,
    private isAlreadyConnected: (address: string) => boolean
  ) {}

  /**
   * Handle a list of peer addresses received from another peer
   */
  public async handlePeerListResponse(peerAddresses: string[]): Promise<void> {
    const myAddress = this.myAddress()

    for (const address of peerAddresses) {
      if (address === myAddress) {
        continue
      }

      if (peers.getPublicPeers().length >= this.maxPeers) {
        return
      }

      if (!this.isAlreadyConnected(address)) {
        logger.info('Connecting to discovered peer:', address)
        this.connectToPeer(address)
        await sleep(this.peerDiscoverySleepMs)
      }
    }
  }

  /**
   * Handle a request for our peer list
   */
  public handlePeerListRequest(senderId: string): void {
    const pubPeers = peers.getPublicPeers()
    if (pubPeers.length === 0) {
      return
    }

    const addresses = pubPeers
      .map((peer) => peer.address)
      .filter(Boolean) as string[]

    const ws = peers.getWS(senderId)
    if (ws) {
      messageList.PEER_LIST(ws, addresses)
    }
  }

  /**
   * Request peer list from network if needed
   */
  public requestPeersIfNeeded(): void {
    const publicPeers = peers.getPublicPeers()
    if (publicPeers.length < this.maxPeers) {
      messageList.REQUEST_PEERS()
    }
  }
}
