import { FullMessage } from '@/types/network.types'
import { messageChecksum } from '@/utils/p2p.utils'
import { logger } from '@/utils/logger'

export class MessageProcessor {
  constructor(private maxMessageSize: number) {}
  /**
   * Parse and validate a message
   */
  public parse(message: string): FullMessage | null {
    if (message.length > this.maxMessageSize) {
      logger.warning(
        `Message length ${message.length} exceeds limit ${this.maxMessageSize}`
      )
      return null
    }

    let parsedMessage: FullMessage
    try {
      parsedMessage = JSON.parse(message) as FullMessage
    } catch {
      return null
    }

    const checksum = messageChecksum(parsedMessage)
    if (!checksum) {
      return null
    }

    return parsedMessage
  }
}
