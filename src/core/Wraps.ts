import { ethers } from 'ethers'
import { operators } from '@/network/Operators'
import { sleep, timeUntil } from '@/utils/time.utils'
import { config } from '@/core/config'
import { ChainName, ChainService } from '../types/chain.types'
import { messageList } from '../network/messageList'
import { logger } from '../utils/logger'
import { Wrap } from './Wrap'

const USERNAME = config.hive.operator.username
const ACTIVE_KEY = config.hive.operator.activeKey

class Wraps {
  private readonly pendingWraps: Map<string, Wrap> = new Map()

  // Keep msgHash for usernames and addresses for retrieving their pending wraps
  private readonly pendingWrapsByAddress: Map<string, string[]> = new Map()
  private readonly pendingWrapsByUsername: Map<string, string[]> = new Map()

  private readonly cutoff = config.general.wrapCutoff

  constructor() {
    setTimeout(() => this.checkPendingWraps(), 30_000)
  }

  // Check and remove already minted pending wraps
  private async checkPendingWraps() {
    try {
      for (const [msgHash, wrap] of this.pendingWraps) {
        const now = Date.now()
        if (wrap.timestamp < now - this.cutoff) {
          this.removePendingWrap(msgHash)
          continue
        }
        // Ask for signatures of the pending wrap if not enough signatures present
        if (wrap.signatures.length < wrap.chainInstance.multisigThreshold) {
          messageList.REQUEST_WRAP_SIGNATURES(msgHash)
          await sleep(50)
        }
        // If older than 10 minutes, check if already minted
        if (wrap.timestamp < now - 600_000) {
          const minted = await wrap.chainInstance.hasMinted(
            wrap.data.trxId,
            wrap.data.opInTrx
          )
          if (minted) {
            this.removePendingWrap(msgHash)
          }
          await sleep(50)
        }
      }
    } catch (e) {
      logger.debug(e)
    } finally {
      setTimeout(() => this.checkPendingWraps(), 20_000)
    }
  }

  public async addNewWrap(
    chainName: ChainName,
    symbol: 'HIVE' | 'HBD',
    chainInstance: ChainService,
    address: string,
    amount: number,
    trxId: string,
    opInTrx: number,
    username: string,
    msgHash: string,
    timestamp: number
  ) {
    // Make sure the address is checksumed
    address = ethers.getAddress(address)
    const wrap = new Wrap(
      chainName,
      symbol,
      chainInstance,
      address,
      amount,
      trxId,
      opInTrx,
      username,
      msgHash,
      timestamp
    )
    if (Date.now() - timestamp > this.cutoff) {
      return
    }
    this.pendingWraps.set(msgHash, wrap)
    if (this.pendingWrapsByAddress.has(address)) {
      this.pendingWrapsByAddress.get(address)?.push(msgHash)
    } else {
      this.pendingWrapsByAddress.set(address, [msgHash])
    }
    if (this.pendingWrapsByUsername.has(username)) {
      this.pendingWrapsByUsername.get(username)?.push(msgHash)
    } else {
      this.pendingWrapsByUsername.set(username, [msgHash])
    }
    // If we are operator, sign and broadcast our signature
    if (USERNAME && ACTIVE_KEY) {
      const signature = await chainInstance.signMsgHash(msgHash)
      await this.addSignature(msgHash, signature, USERNAME)
      messageList.WRAP_SIGNATURES({
        chainName,
        msgHash,
        operators: [USERNAME],
        signatures: [signature],
      })
    }
  }

  /**
   * Add a signature to the pending wrap after verification
   * Verifies the signature matches the operator's public key
   * @param msgHash - Hash of the wrap message
   * @param signature - Operator's signature
   * @param operator - Operator username
   * @param retry - Retry counter for async race conditions
   */
  public async addSignature(
    msgHash: string,
    signature: string,
    operator: string,
    retry = 0
  ) {
    const wrap = this.pendingWraps.get(msgHash)
    if (wrap) {
      if (wrap.hasOperator(operator)) {
        return
      }
      const recoveredAddress = ethers.recoverAddress(msgHash, signature)
      const chain = wrap.chainInstance
      let address: string | undefined
      try {
        const signers = await chain.getSigners()
        address = signers.find(([username]) => username === operator)?.[1]
      } catch {
        const publicKey = operators.get(operator)?.publicKey
        if (!publicKey) {
          return
        }
        address = chain.toAddress(publicKey)
      }
      if (!address) {
        return
      }
      if (address === recoveredAddress) {
        wrap.addSignature(signature)
        wrap.addOperator(operator)
      }
    } else {
      // Operators could process the Hive blocks faster than us and send signatures
      // Wait and try again
      if (retry < 10) {
        setTimeout(() => {
          retry++
          this.addSignature(msgHash, signature, operator, retry)
        }, 5_000)
      }
    }
  }

  public getWrapByHash(msgHash: string) {
    return this.pendingWraps.get(msgHash)
  }

  public getWrapsByUsername(username: string) {
    const msgHashes = this.pendingWrapsByUsername.get(username)
    if (msgHashes) {
      return this.getWrapsByHashes(msgHashes)
    }
    return []
  }

  public getWrapsByAddress(address: string) {
    const msgHashes = this.pendingWrapsByAddress.get(address)
    if (msgHashes) {
      return this.getWrapsByHashes(msgHashes)
    }
    return []
  }

  public getWrapsByHashes(msgHashes: string[]) {
    const wraps: {
      msgHash: Wrap['msgHash']
      data: Wrap['data']
      operators: Wrap['operators']
      signatures: Wrap['signatures']
      timestamp: Wrap['timestamp']
      expiration: string
    }[] = []
    msgHashes?.forEach((hash) => {
      const wrap = this.pendingWraps.get(hash)
      if (!wrap) {
        return
      }
      wraps.push({
        msgHash: wrap.msgHash,
        data: wrap.data,
        operators: wrap.operators,
        signatures: wrap.signatures,
        timestamp: wrap.timestamp,
        expiration: timeUntil(wrap.timestamp + this.cutoff),
      })
    })
    return wraps
  }

  public getAllPendingWraps() {
    return this.pendingWraps
  }

  public removePendingWrap(msgHash: string) {
    const wrap = this.pendingWraps.get(msgHash)
    if (wrap) {
      const wrapsByUsername =
        this.pendingWrapsByUsername.get(wrap.data.username) || []
      const wrapsByAddress =
        this.pendingWrapsByAddress.get(wrap.data.address) || []
      if (wrapsByUsername?.length === 1) {
        this.pendingWrapsByUsername.delete(wrap.data.username)
      } else {
        const temp: string[] = []
        delete wrapsByUsername[wrapsByUsername.indexOf(msgHash)]
        wrapsByUsername.forEach((v) => temp.push(v))
        this.pendingWrapsByUsername.set(wrap.data.username, temp)
      }
      if (wrapsByAddress?.length === 1) {
        this.pendingWrapsByAddress.delete(wrap.data.address)
      } else {
        const temp: string[] = []
        delete wrapsByAddress[wrapsByAddress.indexOf(msgHash)]
        wrapsByAddress.forEach((v) => temp.push(v))
        this.pendingWrapsByAddress.set(wrap.data.address, temp)
      }
      this.pendingWraps.delete(msgHash)
    }
  }
}

export const pendingWraps = new Wraps()
