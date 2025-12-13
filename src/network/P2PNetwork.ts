import { randomUUID } from 'node:crypto'
import { isIPv4, isIPv6 } from 'node:net'
import {
  EventDetail,
  FullMessage,
  Message,
  PeerMessageEvent,
} from '../types/network.types'
import express from 'express'
import { createServer } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import { startListening } from './startListening'
import { config } from '@/config'
import { getMyIP } from '@/utils/getMyIP'
import { peers } from './Peers'
import { operators } from './Operators'
import { sleep } from '@/utils/sleep'
import { messageChecksum, messageHash, uuidValidate } from '@/utils/p2p.utils'
import { logger } from '@/utils/logger'
import { API } from './API'
import { messageList } from './messageList'

class P2PNetwork {
  private heartbeatInterval = config.network.p2p.heartbeatInterval
  private knownPeers: string[] = []
  // Will have double this number of peers connected (50% public + 50% private)
  private maxPeers = config.network.p2p.maxPeers
  private messageRateLimit = config.network.p2p.messageRateLimit
  private handshakeTimeout = config.network.p2p.handshakeTimeout
  private peerCheckInterval = config.network.p2p.peerCheckInterval
  private maxMessageSize = config.network.p2p.maxMessageSize
  private messagesInLastSecond: Map<string, number> = new Map()
  private port: number
  /** Randomly generated uuidv4 */
  private myId: string
  /** It will be automatically saved as ipv4 or [ipv6] */
  private myIP: string = 'none'
  private event = new EventTarget()
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
    }, this.peerCheckInterval)
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
    const server = createServer(app)
    const wss = new WebSocketServer({ server, path: '/' })
    wss.on('connection', (ws) => {
      return this.handleIncomingConnection(ws)
    })

    const host = config.general.host
    server.listen(this.port, host, () => {
      logger.info(`API Server running on http://${host}:${this.port}`)
      logger.info(
        `WebSocket server running on ws://${host}:${this.port} ID: ${this.myId}`
      )
    })
  }

  /** Handles the incoming connection and handshake from peers */
  private handleIncomingConnection(ws: WebSocket) {
    this.setupWebSocketHandlers(ws, {
      isIncoming: true,
      expectedHandshake: 'HELLO',
      onHandshake: (message) => {
        if (peers.getAllPeers().length >= this.maxPeers * 2) {
          return { success: false }
        }
        if (message.type !== 'HELLO' || !message.data?.address) {
          return { success: false }
        }
        return {
          success: true,
          remoteId: message.data.peerId,
          address: message.data.address,
          onSuccess: () => messageList.HELLO_ACK(ws, this.myId),
        }
      },
    })
  }

  /** Add timestamp and hash the message before sending to ws */
  public wsSend = (ws: WebSocket, msg: Message | FullMessage) => {
    if (ws.readyState === WebSocket.OPEN) {
      if ('hash' in msg) {
        // The message is already FullMessage and is a repeat
        peers.addMessage(msg.hash, msg)
        return ws.send(JSON.stringify(msg))
      }
      const timestamp = Date.now()
      const hash = messageHash(JSON.stringify({ ...msg, timestamp }))
      const fullMessage = { ...msg, timestamp, hash }
      // Add message to the seen list
      // so we don't broadcast it again when received from other peers
      peers.addMessage(hash, fullMessage)
      const encodedMsg = JSON.stringify(fullMessage)
      ws.send(encodedMsg)
    } else {
      logger.warning('WebSocket connection is not open. Removing the peer.')
      ws.close()
    }
  }

  /** Regular messages after the initial handshake will be handled here */
  private handleRegularMessage(
    message: FullMessage,
    peerId: string,
    ws: WebSocket
  ) {
    const recentMessageCount = this.messagesInLastSecond.get(peerId) || 0
    if (recentMessageCount > this.messageRateLimit) {
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
    const handshakeTimeoutId = setTimeout(() => {
      if (!remoteId) {
        ws.close()
      }
    }, this.handshakeTimeout)

    ws.onmessage = (event) => {
      const message = this.parseMessage(event.data.toString())
      if (!message) {
        return ws.close()
      }

      if (!remoteId && message.type !== options.expectedHandshake) {
        return ws.close()
      }

      if (!remoteId && message.type === options.expectedHandshake) {
        if (!uuidValidate(message.data.peerId)) {
          return ws.close()
        }

        if (message.data.peerId === this.myId) {
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
      } else if (remoteId && peers.getWS(remoteId)) {
        return this.handleRegularMessage(message, remoteId, ws)
      } else {
        return ws.close()
      }
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

  /** peerAddress without ws:// */
  private connectToPeer(peerAddress: string) {
    if (this.isAlreadyConnected(peerAddress)) {
      return
    }

    try {
      const ws = new WebSocket(`ws://${peerAddress}`)

      ws.onopen = () => {
        messageList.HELLO(ws, this.myId, this.myIP, this.port)
      }

      this.setupWebSocketHandlers(ws, {
        isIncoming: false,
        expectedHandshake: 'HELLO_ACK',
        address: peerAddress,
        onHandshake: (message) => {
          if (message.type !== 'HELLO_ACK') {
            return { success: false }
          }
          return {
            success: true,
            remoteId: message.data.peerId,
            address: peerAddress,
          }
        },
      })
    } catch {
      logger.error(`Failed to connect to known peer ${peerAddress}`)
    }
  }

  private parseMessage = (message: string) => {
    // Check message size before parsing
    if (message.length > this.maxMessageSize) {
      logger.warning(
        `Message length ${message.length} exceeds limit ${this.maxMessageSize}`
      )
      return null
    }

    let parsedMessage: FullMessage
    try {
      parsedMessage = <FullMessage>JSON.parse(message)
    } catch {
      return null
    }
    const checksum = messageChecksum(parsedMessage)
    if (!checksum) {
      return null
    }
    return parsedMessage
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
    }, this.heartbeatInterval)
  }

  private checkPeers() {
    const publicPeers = peers.getPublicPeers()
    const privatePeers = peers.getPrivatePeers()

    this.pruneExcessPeers(privatePeers)
    this.pruneExcessPeers(publicPeers)

    if (publicPeers.length < this.maxPeers) {
      messageList.REQUEST_PEERS()
    }
  }

  /** Remove random peers if we have too many */
  private pruneExcessPeers(peerList: Array<{ id: string }>) {
    if (peerList.length <= this.maxPeers) {
      return
    }
    const peersToRemove = peerList.length - this.maxPeers
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
        await this.handlePeerListResponse(msg.data.peers)
      } else if (msg.type === 'REQUEST_PEERS') {
        this.handlePeerListRequest(pe.detail.sender)
      }
    })
  }

  private async handlePeerListResponse(peerAddresses: string[]) {
    const myAddress = `${this.myIP}:${this.port}`

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
        await sleep(config.network.p2p.peerDiscoverySleepMs)
      }
    }
  }

  private handlePeerListRequest(senderId: string) {
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
