import { addedChainServices } from '@/blockchain'
import { HiveService } from '@/blockchain/hive/HiveService'
import { config } from '@/config'
import { operators, hiveMultisigThreshold } from '@/network/Operators'
import { ChainService } from '@/types/chain.types'
import { TransferBody } from '@/types/hive.types'
import { getAccount, getPublicActiveKeys } from '@/utils/hive.utils'
import { logger } from '@/utils/logger'
import { PrivateKey, Transaction } from 'hive-tx'

type Method =
  | 'add-signer'
  | 'remove-signer'
  | 'update-threshold'
  | 'pause'
  | 'unpause'

const methods: Method[] = [
  'add-signer',
  'remove-signer',
  'update-threshold',
  'pause',
  'unpause',
]

type ProposalKey = `${Method}:${string}`

const proposals: Map<ProposalKey, Proposal> = new Map()

type ChainSymbolKey =
  | `${ChainService['name']}${ChainService['symbol']}`
  | 'hive'

type Signatures = {
  [K in ChainSymbolKey]: string
}
type SignaturesMap = Map<string, Signatures>

class Proposal {
  method: Method
  target?: string
  createdAt: number
  executed: boolean = false
  signatures: SignaturesMap = new Map()

  constructor(method: Method, target?: string) {
    this.method = method
    this.target = target
    this.createdAt = Date.now()
  }

  // TODO: Check operator keys/address on chain and on contracts
  // periodically and produce warnings if they don't match

  async vote(operator: string, signatures: Signatures) {
    if (this.signatures.get(operator)) {
      return
    }
    // Verify the signatures.
    let msgHash: string = ''
    for (const chain of addedChainServices) {
      if (this.method === 'add-signer') {
        const publicKeys = await getPublicActiveKeys(this.target!)
        const address = chain.toAddress(publicKeys[0])
        msgHash = await chain.hashAddSignerMsg(this.target!, address)
      }
      if (this.method === 'remove-signer') {
        msgHash = await chain.hashRemoveSignerMsg(this.target!)
      }
      if (this.method === 'update-threshold') {
        const target = Number(this.target)
        msgHash = await chain.hashUpdateMultisigThresholdMsg(target)
      }
      if (this.method === 'pause') {
        msgHash = await chain.hashPauseMsg()
      }
      if (this.method === 'unpause') {
        msgHash = await chain.hashUnPauseMsg()
      }
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
    // Proposals expire after 7 days
    return Date.now() - this.createdAt > 7 * 24 * 60 * 60 * 1000
  }

  hasEnoughVotes(): boolean {
    return this.signatures.size >= hiveMultisigThreshold
  }
}

export class Governance {
  private hive: HiveService
  private paused: boolean = false
  private treasury = config.hive.treasury
  private username = config.hive.operator.username
  private activeKey = config.hive.operator.activeKey
  private isOperator = this.username && this.activeKey ? true : false

  constructor(hive: HiveService) {
    this.hive = hive

    // Clean up expired proposals every hour
    setInterval(() => this.cleanupExpiredProposals(), 60 * 60 * 1000)

    this.hive.onTransfer((transfer: TransferBody) => {
      // Is sender an operator?
      if (!operators.get(transfer.from)) {
        return
      }
      if (!transfer.memo || transfer.memo.length === 0) {
        return
      }
      const days3 = 1000 * 60 * 60 * 24 * 3
      // Reject actions older than 3days
      if (Date.now() - transfer.timestamp > days3) {
        return
      }
      // "bridge:action:method:target"
      // e.g. "bridge:start:add-signer:mahdiyari"
      // e.g. "bridge:vote:add-signer:mahdiyari"
      const memoParts = transfer.memo.split(':')
      if (memoParts.length < 4) {
        return
      }
      if (memoParts[0] !== 'bridge') {
        return
      }
      const action = memoParts[1]
      if (action !== 'start' && action !== 'vote') {
        return
      }
      const method = <Method>memoParts[2]
      if (!methods.includes(method)) {
        return
      }
      const target = memoParts[3]

      const proposalKey: `${Method}:${string}` = `${method}:${target}`
      if (action === 'start') {
        // TODO: security checks before starting a proposal
        // like check if threshold will break active authority
        if (proposals.has(proposalKey)) {
          logger.warning(
            'Got a transfer to start a proposal but it is already started:',
            proposalKey
          )
          return
        }
        const proposal = new Proposal(method, target)
        proposals.set(proposalKey, proposal)
        // Sign if the transaction was from our operator
        logger.info(`Started proposal: ${proposalKey} by ${transfer.from}`)
        if (this.isOperator) {
          // Sign if the transaction was from our operator
          this.signProposal(proposal)
        }
      }
      if (action === 'vote') {
        // Sign if this is from our operator
        if (!this.isOperator) {
          return
        }
        const proposal = proposals.get(proposalKey)
        if (!proposal) {
          logger.warning(
            "Got a vote for proposal that doesn't exist.",
            proposalKey
          )
          return
        }
        if (proposal.isExpired()) {
          proposals.delete(proposalKey)
          return
        }
        this.signProposal(proposal)
      }
    })
  }

  private async signProposal(proposal: Proposal) {
    switch (proposal.method) {
      case 'add-signer':
        await this.signAddSigner(proposal)
        break
      case 'remove-signer':
        await this.signRemoveSigner(proposal)
        break
      case 'update-threshold':
        await this.signUpdateThreshold(proposal)
        break
      case 'pause':
        this.signPause(proposal)
        break
      case 'unpause':
        this.signUnpause(proposal)
        break
    }
  }

  private async signAddSigner(proposal: Proposal) {
    if (!this.username || !this.activeKey) {
      return
    }
    // Build hive transaction for signing
    // Sign a message for contracts - loop through added chains
    const account = await getAccount(this.treasury)
    if (!account) {
      return
    }
    const activeAuths = account.active
    let sumWeights = 0
    let alreadyAdded = false
    for (const [user, weight] of activeAuths.account_auths) {
      // Don't skip already added signers - maybe it's not added on other chains
      if (user === proposal.target) {
        alreadyAdded = true
      }
      sumWeights += weight
    }
    if (!alreadyAdded) {
      activeAuths.account_auths.push([proposal.target!, 1])
    }
    activeAuths.account_auths.sort((a: any, b: any) => {
      return a[0].localeCompare(b[0])
    })
    const trx = await accountUpdateTrx(
      this.treasury,
      activeAuths,
      account.memo_key
    )
    const hiveSignature = trx.sign(PrivateKey.from(this.activeKey))
      .signatures[0]
    const chainSignatures = {} as Signatures
    for (const chain of addedChainServices) {
      const pubKeys = await getPublicActiveKeys(proposal.target!)
      const address = chain.toAddress(pubKeys[0])
      const sig = await chain.hashAddSignerMsg(proposal.target!, address)
      chainSignatures[`${chain.name}${chain.symbol}`] = sig
    }
    chainSignatures['hive'] = hiveSignature
    proposal.vote(this.username, chainSignatures)
    logger.info(`Voted on proposal:`, `${proposal.method}:${proposal.target}`)
  }

  private async signRemoveSigner(proposal: Proposal) {
    if (!this.username || !this.activeKey) {
      return
    }
    // Build hive transaction for signing
    // Sign a message for contracts - loop through added chains
    const account = await getAccount(this.treasury)
    if (!account) {
      return
    }
    const activeAuths = account.active
    let sumWeights = 0
    let tempSigners: [string, number][] = []
    for (const value of activeAuths.account_auths) {
      if (value[0] !== proposal.target) {
        tempSigners.push(value)
        sumWeights += value[1]
      }
    }
    if (sumWeights < activeAuths.weight_threshold) {
      logger.warning(
        'Skipped adding new signer because sum_weights < weight_threshold'
      )
      return
    }
    activeAuths.account_auths = tempSigners
    activeAuths.account_auths.sort((a: any, b: any) => {
      return a[0].localeCompare(b[0])
    })
    const trx = await accountUpdateTrx(
      this.treasury,
      activeAuths,
      account.memo_key
    )
    const hiveSignature = trx.sign(PrivateKey.from(this.activeKey))
      .signatures[0]
    const chainSignatures = {} as Signatures
    for (const chain of addedChainServices) {
      const sig = await chain.hashRemoveSignerMsg(proposal.target!)
      chainSignatures[`${chain.name}${chain.symbol}`] = sig
    }
    chainSignatures['hive'] = hiveSignature
    proposal.vote(this.username, chainSignatures)
    logger.info(`Voted on proposal:`, `${proposal.method}:${proposal.target}`)
  }

  private async signUpdateThreshold(proposal: Proposal) {
    if (!this.username || !this.activeKey) {
      return
    }
    // Build hive transaction for signing
    // Sign a message for contracts - loop through added chains
    const account = await getAccount(this.treasury)
    if (!account) {
      return
    }
    const activeAuths = account.active
    let sumWeights = 0
    for (const value of activeAuths.account_auths) {
      sumWeights += value[1]
    }
    const newThreshold = Number(proposal.target)
    if (newThreshold > sumWeights) {
      logger.warning(
        'Skipped updating multiSigThreshold because newThreshold > simWeights'
      )
      return
    }
    activeAuths.weight_threshold = newThreshold
    const trx = await accountUpdateTrx(
      this.treasury,
      activeAuths,
      account.memo_key
    )
    const hiveSignature = trx.sign(PrivateKey.from(this.activeKey))
      .signatures[0]
    const chainSignatures = {} as Signatures
    for (const chain of addedChainServices) {
      const sig = await chain.hashUpdateMultisigThresholdMsg(newThreshold)
      chainSignatures[`${chain.name}${chain.symbol}`] = sig
    }
    chainSignatures['hive'] = hiveSignature
    proposal.vote(this.username, chainSignatures)
    logger.info(`Voted on proposal:`, `${proposal.method}:${proposal.target}`)
  }

  private async signPause(proposal: Proposal) {
    if (!this.username || !this.activeKey) {
      return
    }
    const chainSignatures = {} as Signatures
    for (const chain of addedChainServices) {
      const sig = await chain.hashPauseMsg()
      chainSignatures[`${chain.name}${chain.symbol}`] = sig
    }
    chainSignatures['hive'] = ''
    proposal.vote(this.username, chainSignatures)
    logger.info(`Voted on proposal:`, `${proposal.method}:${proposal.target}`)
  }

  private async signUnpause(proposal: Proposal) {
    if (!this.username || !this.activeKey) {
      return
    }
    const chainSignatures = {} as Signatures
    for (const chain of addedChainServices) {
      const sig = await chain.hashUnPauseMsg()
      chainSignatures[`${chain.name}${chain.symbol}`] = sig
    }
    chainSignatures['hive'] = ''
    proposal.vote(this.username, chainSignatures)
    logger.info(`Voted on proposal:`, `${proposal.method}:${proposal.target}`)
  }

  public isPaused(): boolean {
    return this.paused
  }

  private cleanupExpiredProposals() {
    const expiredKeys: string[] = []
    for (const [key, proposal] of proposals) {
      if (proposal.isExpired() && !proposal.executed) {
        expiredKeys.push(key)
      }
    }
    expiredKeys.forEach((key) => {
      proposals.delete(key as ProposalKey)
      logger.info(`Cleaned up expired proposal: ${key}`)
    })
  }
}

const accountUpdateTrx = async (
  username: string,
  activeAuths: any,
  memoKey: string
) => {
  const tx = new Transaction({ expiration: 86_400_000 })
  await tx.addOperation('account_update', {
    account: username,
    active: activeAuths,
    json_metadata: '',
    memo_key: memoKey,
  })
  return tx
}
