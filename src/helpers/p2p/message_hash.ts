import { sha256, toBytes } from '@wevm/viem/utils'

/** Return first 16 hex of sha256 hash of a message */
export const messageHash = (message: string) => {
	return sha256(toBytes(message)).substring(2, 18)
}
