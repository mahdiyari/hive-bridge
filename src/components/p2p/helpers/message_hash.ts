import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'

/** Return first 16 hex of sha256 hash of a message */
export const messageHash = (message: string) => {
  return (<string>sha256String(message)).substring(0, 16)
}

/** sha256 that takes regular string as input - by default return hex string */
export const sha256String = (data: string, hex = true) => {
  const encoded = new TextEncoder().encode(data)
  return hex ? bytesToHex(sha256(encoded)) : sha256(encoded)
}
