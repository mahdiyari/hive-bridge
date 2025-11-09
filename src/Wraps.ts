import { ethers } from 'ethers'
import { operators } from '@/network/Operators'
import { sleep } from '@/utils/sleep'

import { config } from '@/config'
import { ChainName, ChainService } from './types/chain.types'
import { messageList } from './network/messageList'

const USERNAME = config.hive.operator.username
const ACTIVE_KEY = config.hive.operator.activeKey

class Wrap {
  public data: {
    chainName: ChainName
    symbol: 'HIVE' | 'HBD'
    address: string
    amount: number
    trxId: string
    opInTrx: number
    contract: string
    username: string
  }
  public chainInstance: ChainService
  public signatures: string[]
  public operators: string[]
  public timestamp: number
  public msgHash: string

  constructor(
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
    this.data = {
      chainName,
      symbol,
      address,
      amount,
      trxId,
      opInTrx,
      contract: chainInstance.contractAddress,
      username,
    }
    this.chainInstance = chainInstance
    this.msgHash = msgHash
    this.timestamp = timestamp
    this.signatures = []
    this.operators = []
  }

  public addSignature(signature: string) {
    if (!this.signatures.includes(signature)) {
      this.signatures.push(signature)
    }
  }
  public addOperator(operator: string) {
    if (!this.operators.includes(operator)) {
      this.operators.push(operator)
    }
  }
}

class Wraps {
  private pendingWraps: Map<string, Wrap> = new Map()

  // Keep msgHash for usernames and addresses for retrieving their pending wraps
  private pendingWrapsByAddress: Map<string, string[]> = new Map()
  private pendingWrapsByUsername: Map<string, string[]> = new Map()

  private cutoff = 7 * 24 * 60 * 60 * 1000 // 7 days in ms

  constructor() {
    setInterval(() => {
      this.checkPendingWraps()
    }, 15_000)
  }

  // Check and remove already minted pending wraps
  private async checkPendingWraps() {
    for (const [key, value] of this.pendingWraps) {
      const minted = await value.chainInstance.hasMinted(
        value.data.trxId,
        value.data.opInTrx
      )
      await sleep(10)
      if (minted) {
        this.removePendingWrap(key)
      } else {
        // Need to remove old pending wraps to prevent excess RAM usage
        // Someone could spam small transfers and increase the size of pendingHiveWraps variable
        // We prevent < 1 HIVE/HBD wraps to mitigate this
        // 7 days should be safe enough
        const now = Date.now()
        if (
          value.timestamp < now - this.cutoff &&
          this.pendingWraps.size > 1000
        ) {
          this.removePendingWrap(key)
        }
        // Ask for signatures of the pending wrap if not enough signatures present
        if (value.signatures.length < value.chainInstance.multisigThreshold) {
          messageList.REQUEST_WRAP_SIGNATURES(key)
          await sleep(50)
        }
      }
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

  /** Add a signature to the pending wrap */
  public async addSignature(
    msgHash: string,
    signature: string,
    operator: string,
    retry = 0
  ) {
    const wrap = this.pendingWraps.get(msgHash)
    if (wrap) {
      if (wrap.operators.includes(operator)) {
        return
      }
      const recoveredAddress = ethers.recoverAddress(msgHash, signature)
      const chain = wrap.chainInstance
      const publicKey = operators.get(operator)?.publicKey
      if (!publicKey) {
        return
      }
      const address = chain.toAddress(publicKey)
      if (!address) {
        return
      }
      if (address === recoveredAddress) {
        wrap.signatures.push(signature)
        wrap.operators.push(operator)
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
