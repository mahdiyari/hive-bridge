import { messageHash } from './message_hash.ts'
import { FullMessage } from './types.ts'

// Arbitary number which the messages are still considered valid
const MAX_VALID_TIME = 8_000 // 8s

/** Verify the hash of the message and verify the message is not older than 8 seconds */
export const messageChecksum = (
	message: FullMessage,
) => {
	try {
		const jsonMsg: any = { ...message }
		if (
			!Object.hasOwn(jsonMsg, 'type') || !Object.hasOwn(jsonMsg, 'hash') ||
			!Object.hasOwn(jsonMsg, 'timestamp')
		) {
			return false
		}
		if (
			isNaN(jsonMsg.timestamp) ||
			Date.now() - jsonMsg.timestamp > MAX_VALID_TIME
		) {
			return false
		}
		const hash = jsonMsg.hash
		delete jsonMsg.hash
		const newHash = messageHash(JSON.stringify(jsonMsg))
		if (hash !== newHash) {
			console.log('hash doesnt match')
			return false
		}
		return true
	} catch {
		return false
	}
}
