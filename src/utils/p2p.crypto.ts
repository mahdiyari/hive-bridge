/**
 * P2P Network Cryptography
 *
 * Provides end-to-end encryption for P2P messages using:
 * - ECDH key exchange (secp256k1)
 * - ChaCha20-Poly1305 authenticated encryption
 * - Hex encoding for wire format
 */

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { randomBytes } from '@noble/hashes/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'

export class P2PCrypto {
  private privateKey: Uint8Array
  private publicKey: Uint8Array
  private sharedSecrets: Map<string, Uint8Array> = new Map()

  constructor() {
    // Generate ephemeral keypair on startup
    this.privateKey = secp256k1.utils.randomSecretKey()
    this.publicKey = secp256k1.getPublicKey(this.privateKey, true) // compressed
  }

  /**
   * Get our public key as hex string for transmission
   */
  getPublicKeyHex(): string {
    return bytesToHex(this.publicKey)
  }

  /**
   * Derive shared secret from peer's public key using ECDH
   */
  deriveSharedSecret(peerId: string, peerPublicKeyHex: string): boolean {
    try {
      const peerPublicKey = hexToBytes(peerPublicKeyHex)

      // Compute ECDH shared secret
      const sharedPoint = secp256k1.getSharedSecret(this.privateKey, peerPublicKey, true)

      // Derive encryption key from shared secret using SHA-256
      const sharedSecret = sha256(sharedPoint)

      this.sharedSecrets.set(peerId, sharedSecret)
      return true
    } catch {
      return false
    }
  }

  /**
   * Encrypt a message for a specific peer
   * Returns hex-encoded: nonce(24) + ciphertext + tag(16)
   */
  encrypt(peerId: string, plaintext: string): string | null {
    const secret = this.sharedSecrets.get(peerId)
    if (!secret) {
      return null
    }

    try {
      // Generate random 24-byte nonce for ChaCha20
      const nonce = randomBytes(24)

      // Encrypt with XChaCha20-Poly1305
      const cipher = xchacha20poly1305(secret, nonce)
      const plaintextBytes = new TextEncoder().encode(plaintext)
      const ciphertext = cipher.encrypt(plaintextBytes)

      // Concatenate: nonce + ciphertext (includes auth tag)
      const combined = new Uint8Array(nonce.length + ciphertext.length)
      combined.set(nonce, 0)
      combined.set(ciphertext, nonce.length)

      return bytesToHex(combined)
    } catch {
      return null
    }
  }

  /**
   * Decrypt a message from a specific peer
   * Expects hex-encoded: nonce(24) + ciphertext + tag(16)
   */
  decrypt(peerId: string, encryptedHex: string): string | null {
    const secret = this.sharedSecrets.get(peerId)
    if (!secret) {
      return null
    }

    try {
      const combined = hexToBytes(encryptedHex)

      // Extract nonce and ciphertext
      const nonce = combined.slice(0, 24)
      const ciphertext = combined.slice(24)

      // Decrypt with XChaCha20-Poly1305
      const cipher = xchacha20poly1305(secret, nonce)
      const plaintextBytes = cipher.decrypt(ciphertext)

      return new TextDecoder().decode(plaintextBytes)
    } catch {
      return null
    }
  }

  /**
   * Remove shared secret for a peer (when they disconnect)
   */
  removeSecret(peerId: string): void {
    this.sharedSecrets.delete(peerId)
  }

  /**
   * Check if we have a shared secret with a peer
   */
  hasSecret(peerId: string): boolean {
    return this.sharedSecrets.has(peerId)
  }
}

/**
 * Convert bytes to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Convert hex string to bytes
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Invalid hex string')
  }
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}
