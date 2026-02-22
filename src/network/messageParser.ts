import { messageChecksum } from '@/utils/p2p.utils'
import { FullMessageSchema } from './zodSchemas'

export const messageParser = (message: string) => {
  // Prevent deep nesting attacks
  if ((message.match(/\{/g) || []).length > 100) {
    // Arbitrary limit
    throw new Error('Message contains too many nested objects')
  }

  let parsedJson: any
  parsedJson = JSON.parse(message, (key, value) => {
    // Prevent adding dangerous properties
    if (key === '__proto__' || key === 'constructor') {
      return undefined
    }
    return value
  })

  // Validate with Zod
  const validationResult = FullMessageSchema.safeParse(parsedJson)
  if (!validationResult.success) {
    const errors = validationResult.error.issues
      .map((err: any) => `${err.path.join('.')}: ${err.message}`)
      .join(', ')
    throw new Error(`Invalid message format: ${errors}`)
  }

  const parsedMessage = validationResult.data

  const checksum = messageChecksum(parsedMessage)
  if (!checksum) {
    throw new Error('Bad message checksum.')
  }

  return parsedMessage
}
