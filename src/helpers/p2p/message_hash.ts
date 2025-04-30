import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

/** Return sha256 hash of a message */
export const messageHash = (message: string) => {
	return bytesToHex(sha256(message))
}
