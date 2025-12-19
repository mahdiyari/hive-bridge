import { addedChainServices } from '@/blockchain'
import { config } from '@/config'
import { Method, Signatures, SignaturesMap } from '@/types/governance.types'
import { buildAccountUpdate, getAccount } from '@/utils/hive.utils'
import { logger } from '@/utils/logger'
import { Transaction } from 'hive-tx'
import { getChainMessageHash } from './msgHash'
import { hiveMultisigThreshold, operators } from '@/network/Operators'

const treasury = config.hive.treasury

export class Proposal {
  private static readonly PROPOSAL_EXPIRY_DAYS = 1
  method: Method
  target?: string
  createdAt: number
  signatures: SignaturesMap = new Map()
  trx?: Transaction
  created = false

  constructor(
    method: Method,
    timestamp: number,
    blockNum: number,
    target?: string
  ) {
    this.method = method
    this.target = target
    this.createdAt = timestamp
    // Build the hive transactions
    if (method === 'add-signer') {
      this.buildAddSigner(target!, blockNum!).then(() => {
        this.created = true
      })
    } else if (method === 'remove-signer') {
      this.buildRemoveSigner(target!, blockNum!).then(() => {
        this.created = true
      })
    } else if (method === 'update-threshold') {
      this.buildUpdateThreshold(Number(target), blockNum).then(() => {
        this.created = true
      })
    } else {
      this.created = true
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

  async vote(operator: string, signatures: Signatures) {
    if (this.signatures.get(operator)) {
      return
    }
    for (const chain of addedChainServices) {
      const msgHash = await getChainMessageHash(chain, this)
      const recoveredAddress = chain.recoverAddress(
        msgHash,
        signatures[`${chain.name}${chain.symbol}`]
      )
      const operatorAddress = chain.toAddress(
        operators.get(operator)?.publicKey!
      )
      if (operatorAddress !== recoveredAddress) {
        logger.warning(
          `Couldn't verify the signatures for proposal vote from ${operator} for ${this.method}${this.target}`
        )
        return
      }
    }
    this.signatures.set(operator, signatures)
  }

  isExpired(): boolean {
    return (
      Date.now() - this.createdAt >
      Proposal.PROPOSAL_EXPIRY_DAYS * 24 * 60 * 60 * 1000
    )
  }

  hasEnoughVotes(): boolean {
    return this.signatures.size >= hiveMultisigThreshold
  }
}
