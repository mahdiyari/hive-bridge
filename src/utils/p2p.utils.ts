import { config } from '@/config'
import { FullMessage } from '@/types/network.types'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import { Agent } from 'undici'

/** Return true if the peer address is accessible at /status
 * - has a 2s timeout
 * @param address - without https://
 */
export const checkPeerStatus = (
  address: string,
  timeout = 2000
): Promise<boolean> => {
  return new Promise((resolve) => {
    const myTimer = setTimeout(() => {
      resolve(false)
    }, timeout)
    fetch('https://' + address + '/status', {
      dispatcher: new Agent({
        connect: {
          rejectUnauthorized: false,
        },
      }),
    })
      .then((res) => res.json())
      .then((res: any) => {
        if (res.status === 'OK') {
          resolve(true)
          return
        }
        resolve(false)
      })
      .catch(() => {
        resolve(false)
      })
      .finally(() => {
        clearTimeout(myTimer)
      })
  })
}

// Arbitary number which the messages are still considered valid
const MAX_VALID_TIME = config.network.message.maxAgeMs

/** Verify the hash of the message and verify the message is not older than 8 seconds */
export const messageChecksum = (message: FullMessage) => {
  try {
    const jsonMsg: any = { ...message }
    if (
      !Object.hasOwn(jsonMsg, 'type') ||
      !Object.hasOwn(jsonMsg, 'hash') ||
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
      return false
    }
    return true
  } catch {
    return false
  }
}

/** Return first 16 hex of sha256 hash of a message */
export const messageHash = (message: string) => {
  return (<string>sha256String(message)).substring(0, 16)
}

/** sha256 that takes regular string as input - by default return hex string */
export const sha256String = (data: string, hex = true) => {
  const encoded = new TextEncoder().encode(data)
  return hex ? bytesToHex(sha256(encoded)) : sha256(encoded)
}

export const uuidValidate = (uuid: string) => {
  const patern =
    /^[0-9A-F]{8}-[0-9A-F]{4}-[4][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i
  return patern.test(uuid)
}
