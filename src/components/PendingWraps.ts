import { ethers } from 'ethers'
import { operators } from './Operators'
import { sleep } from '../helpers/sleep'
import { ChainServiceInstance } from '../helpers/types'
import { p2pNetwork } from './p2p/P2PNetwork'
import { REQUEST_WRAP_SIGNATURES } from './p2p/message/REQUEST_WRAP_SIGNATURES'
import { WRAP_SIGNATURES } from './p2p/message/WRAP_SIGNATURES'
import { ChainType } from './p2p/helpers/types'

const USERNAME = process.env.USERNAME?.replaceAll('"', '')
const ACTIVE_KEY = process.env.ACTIVE_KEY?.replaceAll('"', '')

class PendingWraps {
  private pendingWraps: Map<
    string,
    {
      data: {
        type: ChainType
        symbol: 'HIVE' | 'HBD'
        address: string
        amount: number
        trxId: string
        opInTrx: number
        contract: string
        username: string
      }
      chainInstance: ChainServiceInstance
      signatures: string[]
      operators: string[]
      timestamp: number
    }
  > = new Map()

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
        // We should prevent < 1 HIVE/HBD wraps to mitigate this
        // 7 days should be safe enough
        const now = Date.now()
        if (value.timestamp < now - this.cutoff) {
          this.removePendingWrap(key)
        }
        // Ask for signatures of the pending wrap if not enough signatures present
        if (value.signatures.length < value.chainInstance.multisigThreshold) {
          REQUEST_WRAP_SIGNATURES(key)
          await sleep(50)
        }
      }
    }
  }

  public async addNewWrap(
    type: ChainType,
    symbol: 'HIVE' | 'HBD',
    chainInstance: ChainServiceInstance,
    address: string,
    amount: number,
    trxId: string,
    opInTrx: number,
    username: string,
    msgHash: string,
    timestamp: number
  ) {
    this.pendingWraps.set(msgHash, {
      data: {
        type,
        symbol,
        address,
        amount,
        trxId,
        opInTrx,
        contract: chainInstance.contractAddress,
        username,
      },
      chainInstance,
      operators: [],
      signatures: [],
      timestamp,
    })
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
      WRAP_SIGNATURES({
        type,
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
      let address = operators.getOperatorAddresses(operator)
      if (!address) {
        await sleep(5000)
        address = operators.getOperatorAddresses(operator)
      }
      if (!address) {
        return
      }
      for (let i = 0; i < address.length; i++) {
        if (address[i] === recoveredAddress) {
          wrap.signatures.push(signature)
          wrap.operators.push(operator)
          break
        }
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
    const msgHashs = this.pendingWrapsByUsername.get(username)
    const wraps: any[] = []
    msgHashs?.forEach((hash) => {
      wraps.push(this.pendingWraps.get(hash))
    })
    return wraps
  }

  public getWrapsByAddress(address: string) {
    const msgHashs = this.pendingWrapsByAddress.get(address)
    const wraps: any[] = []
    msgHashs?.forEach((hash) => {
      wraps.push(this.pendingWraps.get(hash))
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

export const pendingWraps = new PendingWraps()
