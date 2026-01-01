import { FullMessage } from '@/types/network.types'
import { WebSocket } from 'ws'
import { logger } from '@/utils/logger'
import { checkPeerStatus } from '@/utils/p2p.utils'

class Peer {
  public id: string
  public ws: WebSocket
  public address: string | null
  // public lastSeen: number

  constructor(id: string, ws: WebSocket, address: string | null = null) {
    if (!id || !ws) {
      throw new Error('Peer id and WebSocket are required')
    }
    this.id = id
    this.ws = ws
    this.address = address
    // this.lastSeen = Date.now()
  }

  // public updateLastSeen(): void {
  //   this.lastSeen = Date.now()
  // }

  public isPublic(): boolean {
    return this.address !== null
  }
}

class Peers {
  private MESSAGE_LIFESPAN = 10_000 // 10s
  private peers: Map<string, Peer> = new Map()
  private messages: Map<string, FullMessage> = new Map()

  constructor() {
    setInterval(() => {
      // Remove peers that are not seen recently - Maybe not - ws should handle it?
      // this.peers.forEach((value, key) => {
      // 	if (Date.now() - value.lastSeen > this.DISCONNECT_TIME) {
      // 		this.removePeer(key)
      // 	}
      // })
      // Remove older messages
      this.messages.forEach((value, key) => {
        if (Date.now() - value.timestamp > this.MESSAGE_LIFESPAN) {
          this.messages.delete(key)
        }
      })
    }, 5_000)
  }

  public getWS(id: string) {
    return this.peers.get(id)?.ws
  }

  public async addPeer(
    id: string,
    ws: WebSocket,
    address: string | null = null
  ) {
    if (!id || !ws) {
      throw new Error('Peer id and WebSocket are required')
    }

    const peer = this.peers.get(id)
    if (peer) {
      // We are already connected to this peer so close the new connection
      return ws.close()
    }

    // Check the public accessibility of the target peer
    let validAddress: string | null = null
    if (address) {
      const isValid = await checkPeerStatus(address)
      validAddress = isValid ? address : null
    }

    const newPeer = new Peer(id, ws, validAddress)
    this.peers.set(id, newPeer)
  }

  public removePeer(id: string) {
    if (!id) {
      return
    }
    try {
      const peer = this.peers.get(id)
      peer?.ws.close()
    } catch {
      // The connection might been already closed
    } finally {
      logger.debug('Removed peer:', id)
      this.peers.delete(id)
    }
  }

  /** Peers that are publicly accessible from the internet */
  public getPublicPeers(): Peer[] {
    const publicPeers: Peer[] = []
    this.peers.forEach((peer) => {
      if (peer.isPublic()) {
        publicPeers.push(peer)
      }
    })
    return publicPeers
  }

  /** Peers that are not accessible from the internet */
  public getPrivatePeers(): Peer[] {
    const privatePeers: Peer[] = []
    this.peers.forEach((peer) => {
      if (!peer.isPublic()) {
        privatePeers.push(peer)
      }
    })
    return privatePeers
  }

  /** All connected peers */
  public getAllPeers(): Peer[] {
    return Array.from(this.peers.values())
  }

  /** Update lastSeen and operator name of the peer sending heartbeat if we are connected */
  // public receivedHeartbeat(id: string, operator: string): void {
  //   const peer = this.peers.get(id)
  //   if (peer) {
  //     peer.updateLastSeen()
  //   }
  // }

  public messageSeen(hash: string) {
    return this.messages.has(hash)
  }

  public addMessage(hash: string, message: FullMessage) {
    this.messages.set(hash, message)
  }
}

export const peers = new Peers()
