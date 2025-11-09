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
  private heartbeatInterval = 20_000
  private knownPeers: string[] = []
  // Will have double this number of peers connected (50% public + 50% private)
  private maxPeers = 5
  private messageRateLimit = 10 // per second
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
    }, 60_000)
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
    let remoteId: string | undefined
    // timeout after 5 seconds if not handshaked
    setTimeout(() => {
      if (!remoteId) {
        ws.close()
      }
    }, 5_000)

    ws.onmessage = (event) => {
      const message = this.parseMessage(event.data.toString())
      if (!message) {
        return ws.close()
      }
      // If not handshaked and the first message is not hello, close
      if (!remoteId && message.type !== 'HELLO') {
        return ws.close()
      }
      // First message must be type HELLO
      if (!remoteId && message.type === 'HELLO') {
        // Experimental: Don't accept connections if we are at the peers limit
        // Might want to send list of our peers so they can connect instead?
        if (peers.getAllPeers().length >= this.maxPeers * 2) {
          // TODO: send peer list perhaps
          return ws.close()
        }
        // Require ip address in incoming handshake
        if (!message.data?.address) {
          return ws.close()
        }
        // Require valid uuid in incoming handshake
        remoteId = message.data.peerId
        if (!uuidValidate(remoteId)) {
          return ws.close()
        }
        // Don't connect to yourself
        if (remoteId === this.myId) {
          return ws.close()
        }
        // Validate and add new peer
        peers.addPeer(remoteId, ws, message.data.address)
        messageList.HELLO_ACK(ws, this.myId)
      } else if (remoteId && peers.getWS(remoteId)) {
        return this.handleRegularMessage(message, remoteId, ws)
      } else {
        return ws.close()
      }
    }
    ws.onclose = () => {
      if (remoteId && peers.getWS(remoteId)) {
        peers.removePeer(remoteId)
      }
    }
    ws.onerror = () => {
      logger.error('WebSocket error:', remoteId)
      // onclose will be called after this
    }
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

  /** peerAddress without ws:// */
  private connectToPeer(peerAddress: string) {
    try {
      let remoteId: string | undefined
      // skip already connected peers
      const publicPeers = peers.getPublicPeers()
      for (const peer of publicPeers) {
        if (peer.address === peerAddress) {
          return
        }
      }
      const ws = new WebSocket(`ws://${peerAddress}`)

      // Send HELLO onOpen
      ws.onopen = () => {
        // Close the connection after 5s if not handshaked
        setTimeout(() => {
          if (!remoteId) {
            ws.close()
          }
        }, 5_000)
        messageList.HELLO(ws, this.myId, this.myIP, this.port)
      }
      ws.onmessage = (event) => {
        const message = this.parseMessage(event.data.toString())
        if (!message) {
          return ws.close()
        }
        // Any message other than HELLO_ACK is invalid before handshake
        if (!remoteId && message.type !== 'HELLO_ACK') {
          return ws.close()
        }
        if (!remoteId && message.type === 'HELLO_ACK') {
          if (!uuidValidate(message.data.peerId)) {
            ws.close()
            return
          }
          remoteId = message.data.peerId
          // Validate and add new peer
          peers.addPeer(remoteId, ws, peerAddress)
        } else if (remoteId && peers.getWS(remoteId)) {
          return this.handleRegularMessage(message, remoteId, ws)
        } else {
          return ws.close()
        }
      }
      ws.onclose = () => {
        if (remoteId) {
          peers.removePeer(remoteId)
        }
      }
      ws.onerror = () => {
        logger.error(`Error connecting to known peer ${peerAddress}`)
        // onclose will run afterwards
      }
    } catch {
      logger.error(`Failed to connect to known peer ${peerAddress}`)
    }
  }

  private parseMessage = (message: string) => {
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
    // Randomly remove peers if connected to more than maxPeers
    if (privatePeers.length > this.maxPeers) {
      const peersToRemove = privatePeers.length - this.maxPeers
      const rand = getRandomUniqueNumbers(0, privatePeers.length, peersToRemove)
      rand.forEach((val) => {
        peers.removePeer(privatePeers[val].id)
      })
    }
    if (publicPeers.length > this.maxPeers) {
      const peersToRemove = publicPeers.length - this.maxPeers
      const rand = getRandomUniqueNumbers(0, publicPeers.length, peersToRemove)
      rand.forEach((val) => {
        peers.removePeer(publicPeers[val].id)
      })
    } else if (publicPeers.length < this.maxPeers) {
      // Discover and connect to more peers if possible
      messageList.REQUEST_PEERS()
    }
  }

  private handlePeerList() {
    this.event.addEventListener('peerMessage', async (e) => {
      const pe = e as PeerMessageEvent
      const msg = pe.detail.data
      if (msg.type === 'PEER_LIST') {
        for (const val of msg.data.peers) {
          // Don't connect to yourself
          if (val === `${this.myIP}:${this.port}`) {
            continue
          }
          const pubPeers = peers.getPublicPeers()
          if (pubPeers.length >= this.maxPeers) {
            return
          }
          let includes = false
          for (let i = 0; i < pubPeers.length; i++) {
            if (pubPeers[i].address === val) {
              includes = true
              break
            }
          }
          if (!includes) {
            logger.info('Connecting to discovered peer:', val)
            this.connectToPeer(val)
            // Sleep a bit before connecting to new peers
            // Seems like a good idea
            await sleep(500)
          }
        }
      } else if (msg.type === 'REQUEST_PEERS') {
        const pubPeers = peers.getPublicPeers()
        if (pubPeers.length === 0) {
          return
        }
        const addresses: string[] = []
        pubPeers.forEach((val) => {
          addresses.push(<string>val.address)
        })
        const ws = peers.getWS(pe.detail.sender)
        if (!ws) {
          return
        }
        messageList.PEER_LIST(ws, addresses)
      }
    })
  }
}

// AI generated function - seems to work fine
/** Select a certain amount of unique numbers randomly from a range
 * - used to remove some peers randomly
 */
function getRandomUniqueNumbers(
  start: number,
  end: number,
  count: number
): number[] {
  const range = Array.from({ length: end - start + 1 }, (_, i) => i + start)
  for (let i = range.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[range[i], range[j]] = [range[j], range[i]]
  }
  return range.slice(0, count)
}

export const p2pNetwork = new P2PNetwork()
startListening()
