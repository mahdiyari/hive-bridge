import { randomUUID } from 'node:crypto'
import { isIPv4, isIPv6 } from 'node:net'
import {
  EventDetail,
  FullMessage,
  Message,
  PeerMessageEvent,
} from '../types/network.types'
import express from 'express'
import { createServer as createSecureServer } from 'node:https'
import { WebSocketServer, WebSocket } from 'ws'
import { startListening } from './startListening'
import { config } from '@/config'
import { peers } from './Peers'
import { operators } from './Operators'
import { messageHash, uuidValidate } from '@/utils/p2p.utils'
import { logger } from '@/utils/logger'
import { API } from './API'
import { messageList } from './messageList'
import { messageParser } from './messageParser'
import { generateSelfSignedCert } from '@/utils/ssl.tools'
import { IncomingMessage } from 'node:http'
import { sleep } from '@/utils/sleep'

class P2PNetwork {
  // Configuration object
  private readonly cfg = {
    heartbeatInterval: config.network.p2p.heartbeatInterval,
    maxPeers: config.network.p2p.maxPeers,
    messageRateLimit: config.network.p2p.messageRateLimit,
    handshakeTimeout: config.network.p2p.handshakeTimeout,
    peerCheckInterval: config.network.p2p.peerCheckInterval,
    maxMessageSize: config.network.p2p.maxMessageSize,
    peerDiscoverySleepMs: config.network.p2p.peerDiscoverySleepMs,
  }

  private knownPeers: string[] = []
  private messagesInLastSecond: Map<string, number> = new Map()
  private port: number
  /** Randomly generated uuidv4 */
  private myId: string
  private event = new EventTarget()

  // TODO: zod or similar for message type/value verification
  constructor() {
    this.knownPeers = config.general.knownPeers?.split(/,\s?/) || []
    this.port = config.general.port
    this.myId = randomUUID()
  }

  /** Start the P2P network */
  public start() {
    this.startServer().then(() => {
      this.connectToKnownPeers()
      this.handlePeerList()
      this.initiateHeartbeat()
    })
    // Use this to rate limit messages received
    setInterval(() => {
      this.messagesInLastSecond.clear()
    }, 1_000)

    setInterval(() => {
      this.connectToKnownPeers()
      this.checkPeers()
    }, this.cfg.peerCheckInterval)
  }

  /** Receive messages from the P2P network */
  public onMessage(cb: (detail: EventDetail) => void) {
    this.event.addEventListener('peerMessage', (e) => {
      const pe = e as PeerMessageEvent
      cb(pe.detail)
    })
  }

  /** Prepare and send the message to all peers except the exception -
   * @param exception The peer who originally sent this message to us -
   * We don't want to send it back there again
   */
  public sendMessage(message: Message, exception?: string) {
    for (const peer of peers.getAllPeers()) {
      if (peer.id !== exception) {
        this.wsSend(peer.ws, message)
      }
    }
  }

  /** Add timestamp and hash the message before sending to ws */
  public wsSend = (ws: WebSocket, msg: Message | FullMessage) => {
    if (ws.readyState !== WebSocket.OPEN) {
      logger.debug('WebSocket connection is not open. Removing the peer.')
      ws.close()
      return
    }
    let fullMessage: FullMessage
    if ('hash' in msg) {
      // The message is already FullMessage and is a repeat
      fullMessage = msg
      peers.addMessage(msg.hash, msg)
    } else {
      const timestamp = Date.now()
      const hash = messageHash(JSON.stringify({ ...msg, timestamp }))
      fullMessage = { ...msg, timestamp, hash }
      peers.addMessage(hash, fullMessage)
    }
    const encodedMsg = JSON.stringify(fullMessage)
    ws.send(encodedMsg)
  }

  /** Start listening for incoming connections */
  private async startServer() {
    const app = express()
    // Start API
    API(app)
    const { cert, key } = await generateSelfSignedCert()
    const server = createSecureServer({ cert, key }, app)
    const wss = new WebSocketServer({
      server,
      path: '/',
      maxPayload: config.network.p2p.maxMessageSize,
    })
    wss.on('connection', (ws, request) => {
      return this.handleIncomingConnection(ws, request)
    })
    const host = config.general.host
    server.listen(this.port, host, () => {
      logger.info(`API Server running on https://${host}:${this.port}`)
      logger.info(
        `WebSocket server running on wss://${host}:${this.port} ID: ${this.myId}`
      )
    })
  }

  /** Handles the incoming connection and handshake from peers */
  private handleIncomingConnection(ws: WebSocket, request: IncomingMessage) {
    if (peers.getAllPeers().length >= this.cfg.maxPeers * 2) {
      logger.debug('Max peers reached, rejecting connection')
      return ws.close()
    }
    const ip = request.socket.remoteAddress
    if (!ip) {
      return ws.close()
    }
    this.handleHandshake(ws, ip, true)
  }

  /**
   * Handles the outgoing connections
   * peerAddress without ws:// or wss:// e.g. 1.1.1.1:3018
   */
  private connectToPeer(peerAddress: string) {
    if (peers.getAllPeers().length >= this.cfg.maxPeers * 2) {
      logger.debug("Max peers reached, won't connect to new peers")
      return
    }
    const url = new URL(`wss://${peerAddress}`)
    const { hostname, port } = url
    if (this.isAlreadyConnected(hostname, Number(port))) {
      return
    }
    try {
      const ws = new WebSocket(url, {
        rejectUnauthorized: false,
        maxPayload: config.network.p2p.maxMessageSize,
      })
      this.handleHandshake(ws, hostname, false, Number(port))
    } catch {
      logger.warning(`Failed to connect to known peer ${peerAddress}`)
    }
  }

  private handleHandshake(
    ws: WebSocket,
    ip: string,
    incoming: boolean,
    port?: number
  ) {
    let handshaken = false
    // Timeout if not handshaken
    const timeoutTimer = setTimeout(() => {
      if (!handshaken) {
        ws.close()
      }
    }, this.cfg.handshakeTimeout)

    ws.on('open', () => {
      if (!incoming) {
        messageList.HELLO(ws, this.myId, this.port)
      }
    })
    ws.on('error', (e) => {
      logger.debug(e)
      // will close after error
    })
    ws.on('close', (e) => {
      clearTimeout(timeoutTimer)
    })
    let peerId = ''
    ws.on('message', (data) => {
      try {
        const message = messageParser(data.toString())
        if (!handshaken) {
          const expectedType = incoming ? 'HELLO' : 'HELLO_ACK'
          if (message.type !== expectedType) {
            return ws.close()
          } else {
            peerId = message.data?.peerId
            if (
              !peerId ||
              typeof peerId !== 'string' ||
              !uuidValidate(peerId) ||
              peerId === this.myId
            ) {
              return ws.close()
            }
            if (message.type === 'HELLO') {
              port = message.data?.port
              if (
                !port ||
                typeof port !== 'number' ||
                isNaN(port) ||
                port < 1 ||
                port > 65535
              ) {
                return ws.close()
              }
              messageList.HELLO_ACK(ws, this.myId, peerId)
            } else {
              const remoteId = message.data?.remoteId
              if (!remoteId || remoteId !== this.myId) {
                return ws.close()
              }
            }
            if (this.isAlreadyConnected(ip, Number(port))) {
              return ws.close()
            }
            peers.addPeer(peerId, ws, ip, port!)
            handshaken = true
            clearTimeout(timeoutTimer)
          }
        } else {
          this.handleRegularMessage(message, peerId, ws)
        }
      } catch {
        ws.close()
      }
    })
  }

  /** Regular messages after the initial handshake will be handled here */
  private handleRegularMessage(
    message: FullMessage,
    peerId: string,
    ws: WebSocket
  ) {
    const recentMessageCount = this.messagesInLastSecond.get(peerId) || 0
    if (recentMessageCount > this.cfg.messageRateLimit) {
      logger.debug('Rate limit exceeded for peer:', peerId)
      return
    }
    this.messagesInLastSecond.set(peerId, recentMessageCount + 1)
    try {
      // If we have already seen this message, ignore it
      if (peers.messageSeen(message.hash)) {
        return
      }
      peers.addMessage(message.hash, message)
      const messageEvent = new CustomEvent('peerMessage', {
        detail: <EventDetail>{
          type: 'peerMessage',
          data: message,
          sender: peerId,
        },
      })
      this.event.dispatchEvent(messageEvent)
      // Repeat to other peers if not personal communication
      if (!message.private) {
        this.sendMessage(message, peerId)
      }
    } catch {
      logger.debug('malformed message from', peerId)
      // Remove the peer on malformed message?
      ws.close()
    }
  }

  /** Add peers that are in knownPeers list */
  private connectToKnownPeers() {
    for (const peerAddress of this.knownPeers) {
      this.connectToPeer(peerAddress)
    }
  }

  // TODO: make it possible to have to concurrent connections
  /** Check if already connected to a peer address */
  private isAlreadyConnected(ip: string, port: number): boolean {
    return peers
      .getAllPeers()
      .some((peer) => peer.ip === ip && peer.port === port)
  }

  // Operators send a heartbeat message every 90s
  private initiateHeartbeat() {
    const USERNAME = config.hive.operator.username
    const ACTIVE_KEY = config.hive.operator.activeKey
    if (!USERNAME || !ACTIVE_KEY) {
      return
    }
    setInterval(async () => {
      messageList.HEARTBEAT(this.myId)
      // Set our own operator's lastSeen
      operators.get(USERNAME)?.updateLastSeen()
    }, this.cfg.heartbeatInterval)
  }

  private checkPeers() {
    const publicPeers = peers.getPublicPeers()
    const privatePeers = peers.getPrivatePeers()
    this.pruneExcessPeers(privatePeers)
    this.pruneExcessPeers(publicPeers)
    if (publicPeers.length < this.cfg.maxPeers) {
      messageList.REQUEST_PEERS()
    }
  }

  /** Remove random peers if we have too many */
  private pruneExcessPeers(peerList: Array<{ id: string }>) {
    if (peerList.length <= this.cfg.maxPeers) {
      return
    }
    const peersToRemove = peerList.length - this.cfg.maxPeers
    const indices = getRandomUniqueNumbers(
      0,
      peerList.length - 1,
      peersToRemove
    )
    indices.forEach((index) => {
      logger.debug('Pruning excess peer:', peerList[index].id)
      peers.removePeer(peerList[index].id)
    })
  }

  private handlePeerList() {
    this.onMessage(async (detail) => {
      const msg = detail.data
      const sender = detail.sender
      if (msg.type === 'PEER_LIST') {
        for (const address of msg.data.peers) {
          if (peers.getPublicPeers().length >= this.cfg.maxPeers) {
            return
          }
          logger.debug('Connecting to discovered peer:', address)
          this.connectToPeer(address)
          await sleep(this.cfg.peerDiscoverySleepMs)
        }
      } else if (msg.type === 'REQUEST_PEERS') {
        const pubPeers = peers.getPublicPeers()
        if (pubPeers.length === 0) {
          return
        }
        const addresses = pubPeers.map((peer) => `${peer.ip}:${peer.port}`)
        const ws = peers.getWS(sender)
        if (ws) {
          messageList.PEER_LIST(ws, addresses)
        }
      }
    })
  }
}

/** Select random unique indices from a range */
function getRandomUniqueNumbers(
  start: number,
  end: number,
  count: number
): number[] {
  const result: number[] = []
  const available = new Set(
    Array.from({ length: end - start + 1 }, (_, i) => i + start)
  )

  while (result.length < count && available.size > 0) {
    const arr = Array.from(available)
    const index = Math.floor(Math.random() * arr.length)
    const value = arr[index]
    result.push(value)
    available.delete(value)
  }

  return result
}

export const p2pNetwork = new P2PNetwork()
startListening()
