import { WebSocket } from 'ws'
import { logger } from '@/utils/logger'
import { checkPeerStatus } from '@/utils/p2p.utils'
import { isIPv6 } from 'net'
import { FullMessage } from './zodSchemas'

class Peer {
  public ip: string
  public isPublic = false
  constructor(
    public id: string,
    public ws: WebSocket,
    ip: string,
    public port: number
  ) {
    this.ip = isIPv6(ip) ? `[${ip}]` : ip
    this.checkPublic()
  }
  // Maybe do ping/pong in an interval and disconnect if not seen recently?
  // Don't think it's necessary
  // Maybe if there are network problems later

  private checkPublic() {
    checkPeerStatus(`${this.ip}:${this.port}`).then((res) => {
      this.isPublic = res
    })
  }
}

class Peers {
  private MESSAGE_LIFESPAN = 10_000 // 10s
  private peers: Map<string, Peer> = new Map()
  private messages: Map<string, FullMessage> = new Map()

  constructor() {
    setInterval(() => {
      // Remove older messages
      this.messages.forEach((value, key) => {
        if (Date.now() - value.timestamp > this.MESSAGE_LIFESPAN) {
          this.messages.delete(key)
        }
      })
      this.peers.forEach((peer, key) => {
        if (peer.ws.readyState !== WebSocket.OPEN) {
          logger.debug('Removing CLOSED peer:', key)
          this.removePeer(key)
        }
      })
    }, 5_000)
  }

  public getWS(id: string) {
    return this.peers.get(id)?.ws
  }

  public async addPeer(id: string, ws: WebSocket, ip: string, port: number) {
    const peer = this.peers.get(id)
    if (peer) {
      // We are already connected to this peer so close the new connection
      return ws.close()
    }
    const newPeer = new Peer(id, ws, ip, port)
    this.peers.set(id, newPeer)
    logger.debug('New peer added:', id)
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
      if (peer.isPublic) {
        publicPeers.push(peer)
      }
    })
    return publicPeers
  }

  /** Peers that are not accessible from the internet */
  public getPrivatePeers(): Peer[] {
    const privatePeers: Peer[] = []
    this.peers.forEach((peer) => {
      if (!peer.isPublic) {
        privatePeers.push(peer)
      }
    })
    return privatePeers
  }

  /** All connected peers */
  public getAllPeers(): Peer[] {
    return Array.from(this.peers.values())
  }

  public messageSeen(hash: string) {
    return this.messages.has(hash)
  }

  public addMessage(hash: string, message: FullMessage) {
    this.messages.set(hash, message)
  }
}

export const peers = new Peers()
