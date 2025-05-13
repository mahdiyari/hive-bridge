import { sha256 } from '@noble/hashes/sha2'
import { bytesToHex } from '@noble/hashes/utils'

/** Return first 16 hex of sha256 hash of a message */
export const messageHash = (message: string) => {
	return bytesToHex(sha256(message)).substring(0, 16)
}
