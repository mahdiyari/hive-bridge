import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

export const messageHash = (message: string) => {
	return bytesToHex(sha256(message))
}
