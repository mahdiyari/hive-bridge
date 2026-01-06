import { WebSocket } from 'ws'
import { FullMessage } from '@/types/network.types'
import { uuidValidate } from '@/utils/p2p.utils'
import { logger } from '@/utils/logger'
import { peers } from './Peers'

export interface HandshakeResult {
  success: boolean
  remoteId?: string
  address?: string
  onSuccess?: () => void
}

export type HandshakeValidator = (message: FullMessage) => HandshakeResult

export class HandshakeHandler {
  constructor(private myId: string, private handshakeTimeout: number) {}

  /**
   * Setup handshake timeout and return cleanup function
   */
  public setupTimeout(ws: WebSocket, onTimeout: () => void): NodeJS.Timeout {
    return setTimeout(() => {
      onTimeout()
      ws.close()
    }, this.handshakeTimeout)
  }

  /**
   * Validate incoming handshake message
   */
  public validateHandshake(
    message: FullMessage,
    expectedType: 'HELLO' | 'HELLO_ACK'
  ): boolean {
    if (message.type !== expectedType) {
      return false
    }
    if (!message.data?.peerId || !uuidValidate(message.data.peerId)) {
      return false
    }
    // Don't connect to ourselves
    if (message.data.peerId === this.myId) {
      logger.warning('Attempted to connect to self')
      return false
    }
    return true
  }

  /**
   * Process HELLO handshake for incoming connections
   */
  public processIncomingHandshake(
    message: FullMessage,
    maxPeers: number
  ): HandshakeResult {
    if (peers.getAllPeers().length >= maxPeers * 2) {
      logger.debug('Max peers reached, rejecting connection')
      return { success: false }
    }
    if (message.type !== 'HELLO' || !message.data?.address) {
      return { success: false }
    }
    const peerId = message.data.peerId
    return {
      success: true,
      remoteId: peerId,
      address: message.data.address,
    }
  }

  /**
   * Process HELLO_ACK handshake for outgoing connections
   */
  public processOutgoingHandshake(
    message: FullMessage,
    peerAddress: string
  ): HandshakeResult {
    if (message.type !== 'HELLO_ACK') {
      return { success: false }
    }
    const peerId = message.data.peerId
    return {
      success: true,
      remoteId: peerId,
      address: peerAddress,
    }
  }
}
