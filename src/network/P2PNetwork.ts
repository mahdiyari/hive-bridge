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
import { getMyIP } from '@/utils/getMyIP'
import { peers } from './Peers'
import { operators } from './Operators'
import { messageHash } from '@/utils/p2p.utils'
import { logger } from '@/utils/logger'
import { API } from './API'
import { messageList } from './messageList'
import { MessageProcessor } from './MessageProcessor'
import { HandshakeHandler } from './HandshakeHandler'
import { PeerDiscovery } from './PeerDiscovery'
import { generateSelfSignedCert } from '@/utils/ssl.tools'

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
  /** It will be automatically saved as ipv4 or [ipv6] */
  private myIP: string = 'none'
  private event = new EventTarget()

  // Services
  private messageProcessor: MessageProcessor
  private handshakeHandler: HandshakeHandler
  private peerDiscovery: PeerDiscovery

  private personalMessageTypes = [
    'HELLO',
    'HELLO_ACK',
    'REQUEST_PEERS',
    'PEER_LIST',
    'REQUEST_WRAP_SIGNATURES',
    'REQUEST_HIVE_SIGNATURES',
  ]

  constructor() {
    this.knownPeers = config.general.knownPeers?.split(/,\s?/) || []
    this.port = config.general.port
    this.myId = randomUUID()

    // Initialize services
    this.messageProcessor = new MessageProcessor(this.cfg.maxMessageSize)
    this.handshakeHandler = new HandshakeHandler(
      this.myId,
      this.cfg.handshakeTimeout
    )
    this.peerDiscovery = new PeerDiscovery(
      () => `${this.myIP}:${this.port}`,
      this.cfg.maxPeers,
      this.cfg.peerDiscoverySleepMs,
      (address) => this.connectToPeer(address),
      (address) => this.isAlreadyConnected(address)
    )
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
        this.wsSend(peer.ws, message, peer.id)
      }
    }
  }

  /** Get the public IP and start listening for incoming connections */
  private async startServer() {
    const ip = await getMyIP()
    if (isIPv6(ip.ip)) {
      this.myIP = `[${ip.ip}]`
    } else if (isIPv4(ip.ip)) {
      this.myIP = ip.ip
    }
    const app = express()
    // Start API
    API(app)
    const { cert, key } = await generateSelfSignedCert()
    const server = createSecureServer({ cert, key }, app)
    const wss = new WebSocketServer({ server, path: '/' })
    wss.on('connection', (ws) => {
      return this.handleIncomingConnection(ws)
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
  private handleIncomingConnection(ws: WebSocket) {
    this.setupWebSocketHandlers(ws, {
      isIncoming: true,
      expectedHandshake: 'HELLO',
      onHandshake: (message) => {
        const result = this.handshakeHandler.processIncomingHandshake(
          message,
          this.cfg.maxPeers
        )

        if (result.success) {
          return {
            ...result,
            onSuccess: () => messageList.HELLO_ACK(ws, this.myId),
          }
        }

        return result
      },
    })
  }

  /** Add timestamp and hash the message before sending to ws */
  public wsSend = (
    ws: WebSocket,
    msg: Message | FullMessage,
    peerId?: string
  ) => {
    if (ws.readyState !== WebSocket.OPEN) {
      logger.warning('WebSocket connection is not open. Removing the peer.')
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

  /** Regular messages after the initial handshake will be handled here */
  private handleRegularMessage(
    message: FullMessage,
    peerId: string,
    ws: WebSocket
  ) {
    const recentMessageCount = this.messagesInLastSecond.get(peerId) || 0
    if (recentMessageCount > this.cfg.messageRateLimit) {
      logger.warning('Rate limit exceeded for peer:', peerId)
      return
    }
    this.messagesInLastSecond.set(peerId, recentMessageCount + 1)

    try {
      // If we have already seen this message, ignore it
      if (peers.messageSeen(message.hash)) {
        logger.warning('already seen this message', message)
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
      if (!this.personalMessageTypes.includes(message.type)) {
        this.sendMessage(message, peerId)
      }
    } catch {
      logger.warning('malformed message from', peerId)
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

  /** Check if already connected to a peer address */
  private isAlreadyConnected(peerAddress: string): boolean {
    return peers.getAllPeers().some((peer) => peer.address === peerAddress)
  }

  /** Unified WebSocket handler setup for both incoming and outgoing connections */
  private setupWebSocketHandlers(
    ws: WebSocket,
    options: {
      isIncoming: boolean
      expectedHandshake: 'HELLO' | 'HELLO_ACK'
      address?: string
      onHandshake: (message: FullMessage) => {
        success: boolean
        remoteId?: string
        address?: string
        onSuccess?: () => void
      }
    }
  ) {
    let remoteId: string | undefined
    const handshakeTimeoutId = this.handshakeHandler.setupTimeout(ws, () => {
      if (!remoteId) {
        logger.warning('Handshake timeout')
      }
    })
    ws.onmessage = (event) => {
      const rawData = event.data.toString()
      const message = this.messageProcessor.parse(rawData)
      if (!message) {
        return ws.close()
      }
      // Handle handshake
      if (!remoteId) {
        if (
          !this.handshakeHandler.validateHandshake(
            message,
            options.expectedHandshake
          )
        ) {
          return ws.close()
        }
        const result = options.onHandshake(message)
        if (!result.success) {
          return ws.close()
        }
        remoteId = result.remoteId
        clearTimeout(handshakeTimeoutId)
        peers.addPeer(remoteId!, ws, result.address || null)
        result.onSuccess?.()
        return
      }
      // Handle regular messages
      if (peers.getWS(remoteId)) {
        return this.handleRegularMessage(message, remoteId, ws)
      }
      ws.close()
    }

    ws.onclose = () => {
      clearTimeout(handshakeTimeoutId)
      if (remoteId) {
        peers.removePeer(remoteId)
      }
    }

    ws.onerror = () => {
      const context = options.address || remoteId || 'unknown'
      logger.error(`WebSocket error:`, context)
    }
  }

  /** peerAddress without ws:// or wss:// */
  private connectToPeer(peerAddress: string) {
    if (this.isAlreadyConnected(peerAddress)) {
      return
    }
    try {
      const ws = new WebSocket(`wss://${peerAddress}`, {
        rejectUnauthorized: false,
      })
      ws.onopen = () => {
        messageList.HELLO(ws, this.myId, this.myIP, this.port)
      }
      this.setupWebSocketHandlers(ws, {
        isIncoming: false,
        expectedHandshake: 'HELLO_ACK',
        address: peerAddress,
        onHandshake: (message) => {
          return this.handshakeHandler.processOutgoingHandshake(
            message,
            peerAddress
          )
        },
      })
    } catch {
      logger.error(`Failed to connect to known peer ${peerAddress}`)
    }
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

    this.peerDiscovery.requestPeersIfNeeded()
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
      peers.removePeer(peerList[index].id)
    })
  }

  private handlePeerList() {
    this.event.addEventListener('peerMessage', async (e) => {
      const pe = e as PeerMessageEvent
      const msg = pe.detail.data

      if (msg.type === 'PEER_LIST') {
        await this.peerDiscovery.handlePeerListResponse(msg.data.peers)
      } else if (msg.type === 'REQUEST_PEERS') {
        this.peerDiscovery.handlePeerListRequest(pe.detail.sender)
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
