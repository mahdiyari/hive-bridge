import { messageHash } from './message_hash.ts'
import { FullMessage } from './p2p/types.ts'

/** Verify the hash of the message and verify the message is not older than 5 seconds */
export const messageChecksum = (
	message: string | FullMessage,
) => {
	try {
		const jsonMsg = typeof message === 'string' ? JSON.parse(message) : message
		if (
			!Object.hasOwn(jsonMsg, 'type') || !Object.hasOwn(jsonMsg, 'hash') ||
			!Object.hasOwn(jsonMsg, 'timestamp')
		) {
			return false
		}
		if (isNaN(jsonMsg.timestamp) || Date.now() - jsonMsg.timestamp > 5000) {
			return false
		}
		const hash = jsonMsg.hash
		delete jsonMsg.hash
		const newHash = messageHash(JSON.stringify(jsonMsg))
		if (hash !== newHash) {
			return false
		}
		return true
	} catch {
		return false
	}
}
