import { FullMessage } from '@/types/network.types'
import { messageChecksum } from '@/utils/p2p.utils'
import { logger } from '@/utils/logger'
import { config } from '@/config'

export const messageParser = (message: string): FullMessage => {
  // Prevent deep nesting attacks
  if ((message.match(/\{/g) || []).length > 100) {
    // Arbitrary limit
    throw new Error('Message contains too many nested objects')
  }

  let parsedMessage: FullMessage
  parsedMessage = JSON.parse(message, (key, value) => {
    // Prevent adding dangerous properties
    if (key === '__proto__' || key === 'constructor') {
      return undefined
    }
    return value
  }) as FullMessage

  const checksum = messageChecksum(parsedMessage)
  if (!checksum) {
    throw new Error('Bad message checksum.')
  }

  return parsedMessage
}
