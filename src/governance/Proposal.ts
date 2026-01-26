import { addedChainServices } from '@/blockchain'
import { config } from '@/config'
import { ChainSymbolKey, Method, ProposalKey } from '@/types/governance.types'
import {
  buildAccountUpdate,
  getAccount,
  getPublicActiveKeys,
} from '@/utils/hive.utils'
import { logger } from '@/utils/logger'
import { callRPC, Signature, Transaction } from 'hive-tx'
import { getChainMessageHash } from './msgHash'
import { hiveMultisigThreshold, operators } from '@/network/Operators'
import { sleep } from '@/utils/sleep'
import { messageList } from '@/network/messageList'

const treasury = config.hive.treasury

export class Proposal {
  private static readonly PROPOSAL_EXPIRY_DAYS = 1
  chain: ChainSymbolKey
  method: Method
  target: string
  nonce: number
  blockNum: number
  createdAt: number
  /** <username, sginature> */
  signatures: Map<string, string> = new Map()
  trx?: Transaction
  created = false
  proposalKey: ProposalKey

  constructor(
    chain: ChainSymbolKey,
    method: Method,
    timestamp: number,
    blockNum: number,
    target: string,
    nonce: number
  ) {
    this.chain = chain
    this.method = method
    this.target = target
    this.nonce = nonce
    this.blockNum = blockNum
    this.createdAt = timestamp
    // Build the hive transactions
    if (chain === 'HIVE') {
      if (method === 'add-signer') {
        this.buildAddSigner(target, blockNum).then(() => {
          this.created = true
        })
      } else if (method === 'remove-signer') {
        this.buildRemoveSigner(target, blockNum).then(() => {
          this.created = true
        })
      } else if (method === 'update-threshold') {
        this.buildUpdateThreshold(Number(target), blockNum).then(() => {
          this.created = true
        })
      } else {
        throw new Error(`${method} for chain HIVE not implemented`)
      }
    } else {
      this.created = true
    }
    this.proposalKey = `${chain}:${method}:${target}:${blockNum}`

    const checkInterval = setInterval(async () => {
      this.checkAndAskForSignatures()
      if (this.isExpired() || (await this.isDone())) {
        clearInterval(checkInterval)
      }
    }, 30_000)
  }

  // Check periodically and if not enough signatures, ask peers
  private checkAndAskForSignatures() {
    if (!this.hasEnoughVotes()) {
      messageList.REQUEST_GOVERNANCE(this.proposalKey)
    }
  }

  private async buildAddSigner(username: string, blockNum: number) {
    const account = await getAccount(treasury)
    const activeAuths = account.active
    let alreadyAdded = false
    for (const [user] of activeAuths.account_auths) {
      if (user === username) {
        alreadyAdded = true
      }
    }
    if (!alreadyAdded) {
      activeAuths.account_auths.push([username, 1])
    }
    activeAuths.account_auths.sort((a: any, b: any) => a[0].localeCompare(b[0]))
    this.trx = await buildAccountUpdate(
      treasury,
      activeAuths,
      account.memo_key,
      blockNum
    )
  }

  private async buildRemoveSigner(username: string, blockNum: number) {
    const account = await getAccount(treasury)
    const activeAuths = account.active
    let sumWeights = 0
    let tempSigners: [string, number][] = []
    for (const value of activeAuths.account_auths) {
      if (value[0] !== username) {
        tempSigners.push(value)
        sumWeights += value[1]
      }
    }
    if (sumWeights < activeAuths.weight_threshold) {
      logger.warning(
        'Skipped removing signer because sum_weights < weight_threshold'
      )
      return
    }
    activeAuths.account_auths = tempSigners
    activeAuths.account_auths.sort((a: any, b: any) => a[0].localeCompare(b[0]))
    this.trx = await buildAccountUpdate(
      treasury,
      activeAuths,
      account.memo_key,
      blockNum
    )
  }

  private async buildUpdateThreshold(newThreshold: number, blockNum: number) {
    const account = await getAccount(treasury)
    const activeAuths = account.active
    let sumWeights = 0
    for (const value of activeAuths.account_auths) {
      sumWeights += value[1]
    }
    if (newThreshold > sumWeights) {
      logger.warning(
        'Skipped updating multiSigThreshold because newThreshold > simWeights'
      )
      return
    }
    activeAuths.weight_threshold = newThreshold
    this.trx = await buildAccountUpdate(
      treasury,
      activeAuths,
      account.memo_key,
      blockNum
    )
  }

  // TODO: Check operator keys/address on chain and on contracts
  // periodically and produce warnings if they don't match

  async vote(operator: string, signature: string): Promise<void> {
    if (!this.created) {
      await sleep(200)
      return this.vote(operator, signature)
    }
    if (this.signatures.get(operator)) {
      return
    }
    if (!operators.get(operator)) {
      return
    }
    if (this.chain === 'HIVE') {
      if (!this.trx) {
        return
      }
      const op = operators.get(operator)
      if (!op) {
        logger.warning(
          `Got a vote for proposal ${this.proposalKey} but operator doesn't exist ${operator}`
        )
        return
      }
      const opKey = op.publicKey
      const sig = Signature.from(signature)
      const recovered = sig.getPublicKey(this.trx?.digest().digest)
      if (recovered.toString() !== opKey) {
        logger.warning(
          `Couldn't verify signature for proposal vote from ${operator} for ${this.proposalKey}`
        )
        return
      }
      this.trx.addSignature(signature)
    } else {
      const chain = addedChainServices[this.chain]
      const msgHash = await getChainMessageHash(chain, this)
      const recoveredAddress = chain.recoverAddress(msgHash, signature)
      const operatorAddress = chain.toAddress(
        operators.get(operator)?.publicKey!
      )
      if (operatorAddress !== recoveredAddress) {
        logger.warning(
          `Couldn't verify the signatures for proposal vote from ${operator} for ${this.proposalKey}`
        )
        return
      }
    }
    this.signatures.set(operator, signature)
    if (this.chain === 'HIVE') {
      if (this.hasEnoughVotes()) {
        this.broadcastOnHive()
      }
    }
  }

  isExpired(): boolean {
    return (
      Date.now() - this.createdAt >
      Proposal.PROPOSAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    )
  }

  hasEnoughVotes(): boolean {
    if (this.chain === 'HIVE') {
      return this.signatures.size >= hiveMultisigThreshold
    }
    if (this.chain === 'ETHHIVE') {
      return (
        this.signatures.size >= addedChainServices.ETHHIVE.multisigThreshold
      )
    }
    if (this.chain === 'ETHHBD') {
      return this.signatures.size >= addedChainServices.ETHHBD.multisigThreshold
    }
    return false
  }

  async isDone(): Promise<boolean> {
    try {
      if (this.chain === 'HIVE') {
        if (this.trx) {
          const trxId = this.trx.digest().txId
          const res = await callRPC('condenser_api.get_transaction', [trxId])
          if (res && res.transaction_id === trxId) {
            return true
          }
        }
      } else {
        const nonce = await addedChainServices[this.chain].getNonce(this.method)
        if (nonce > this.nonce) {
          return true
        }
      }
      return false
    } catch {
      // Can throw error if hive transaction is not found
      return false
    }
  }

  private broadcastOnHive() {
    // broadcast happens every time a new signature is added after the threshold
    // could limit it to one run but no harm in re-trying just in case wasn't broadcasted
    if (this.trx) {
      this.trx.broadcast().catch()
    }
  }
}
