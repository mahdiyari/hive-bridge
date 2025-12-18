import { addedChainServices } from '@/blockchain'
import { HiveService } from '@/blockchain/hive/HiveService'
import { config } from '@/config'
import { operators } from '@/network/Operators'
import { TransferBody } from '@/types/hive.types'
import { getAccount } from '@/utils/hive.utils'
import { logger } from '@/utils/logger'
import { PrivateKey, Transaction } from 'hive-tx'
import { Proposal } from './Proposal'
import { Method, ProposalKey, Signatures } from '@/types/governance.types'
import { getChainMessageHash } from './msgHash'

const treasury = config.hive.treasury

const methods: Method[] = [
  'add-signer',
  'remove-signer',
  'update-threshold',
  'pause',
  'unpause',
]

type ProposalAction = 'start' | 'vote'

const proposalActions: ProposalAction[] = ['start', 'vote']

export const proposals: Map<ProposalKey, Proposal> = new Map()

export class Governance {
  private static readonly CLEANUP_INTERVAL_HOURS = 1
  private static readonly STALE_ACTION_DAYS = 1

  private hive: HiveService
  private paused: boolean = false
  private username = config.hive.operator.username
  private activeKey = config.hive.operator.activeKey
  private isOperator = this.username && this.activeKey ? true : false

  constructor(hive: HiveService) {
    this.hive = hive

    setInterval(
      () => this.cleanupExpiredProposals(),
      Governance.CLEANUP_INTERVAL_HOURS * 60 * 60 * 1000
    )

    this.hive.onTransfer((transfer: TransferBody) => {
      // Is sender an operator?
      if (!operators.get(transfer.from)) {
        return
      }
      if (!transfer.memo || transfer.memo.length === 0) {
        return
      }
      if (
        Date.now() - transfer.timestamp >
        Governance.STALE_ACTION_DAYS * 24 * 60 * 60 * 1000
      ) {
        return
      }
      // "governance:action:method:target"
      // e.g. "governance:start:add-signer:mahdiyari"
      // e.g. "governance:vote:add-signer:mahdiyari"
      const memoParts = transfer.memo.split(':')
      if (memoParts.length < 4) {
        return
      }
      if (memoParts[0] !== 'governance') {
        return
      }
      const action = memoParts[1] as ProposalAction
      if (!proposalActions.includes(action)) {
        return
      }
      const method = memoParts[2] as Method
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
        const proposal = new Proposal(
          method,
          transfer.timestamp,
          transfer.blockNum,
          target
        )
        proposals.set(proposalKey, proposal)
        logger.info(`Started proposal: ${proposalKey} by ${transfer.from}`)
        if (this.isOperator) {
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

  private async buildChainSignatures(
    proposal: Proposal,
    hiveSignature: string = ''
  ): Promise<Signatures> {
    const chainSignatures = {} as Signatures

    for (const chain of addedChainServices) {
      const sig = await getChainMessageHash(chain, proposal, true)
      chainSignatures[`${chain.name}${chain.symbol}`] = sig
    }

    chainSignatures['hive'] = hiveSignature
    return chainSignatures
  }

  private async buildHiveAuthoritySignature(
    modifier: (activeAuths: any) => boolean
  ): Promise<string | null> {
    const account = await getAccount(treasury)
    if (!account) return null

    const activeAuths = account.active
    const isValid = modifier(activeAuths)
    if (!isValid) return null

    activeAuths.account_auths.sort((a: any, b: any) => a[0].localeCompare(b[0]))

    const trx = await accountUpdateTrx(treasury, activeAuths, account.memo_key)

    return trx.sign(PrivateKey.from(this.activeKey!)).signatures[0]
  }

  private submitVote(proposal: Proposal, signatures: Signatures) {
    proposal.vote(this.username!, signatures)
    logger.info(`Voted on proposal:`, `${proposal.method}:${proposal.target}`)
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
    const hiveSignature = await this.buildHiveAuthoritySignature(
      (activeAuths) => {
        let alreadyAdded = false
        for (const [user] of activeAuths.account_auths) {
          if (user === proposal.target) {
            alreadyAdded = true
          }
        }
        if (!alreadyAdded) {
          activeAuths.account_auths.push([proposal.target!, 1])
        }
        return true
      }
    )
    if (!hiveSignature) return
    const chainSignatures = await this.buildChainSignatures(
      proposal,
      hiveSignature
    )
    this.submitVote(proposal, chainSignatures)
  }

  private async signRemoveSigner(proposal: Proposal) {
    if (!this.username || !this.activeKey) {
      return
    }
    const hiveSignature = await this.buildHiveAuthoritySignature(
      (activeAuths) => {
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
          return false
        }
        activeAuths.account_auths = tempSigners
        return true
      }
    )
    if (!hiveSignature) return
    const chainSignatures = await this.buildChainSignatures(
      proposal,
      hiveSignature
    )
    this.submitVote(proposal, chainSignatures)
  }

  private async signUpdateThreshold(proposal: Proposal) {
    if (!this.username || !this.activeKey) {
      return
    }
    const newThreshold = Number(proposal.target)
    const hiveSignature = await this.buildHiveAuthoritySignature(
      (activeAuths) => {
        let sumWeights = 0
        for (const value of activeAuths.account_auths) {
          sumWeights += value[1]
        }
        if (newThreshold > sumWeights) {
          logger.warning(
            'Skipped updating multiSigThreshold because newThreshold > simWeights'
          )
          return false
        }
        activeAuths.weight_threshold = newThreshold
        return true
      }
    )
    if (!hiveSignature) return
    const chainSignatures = await this.buildChainSignatures(
      proposal,
      hiveSignature
    )
    this.submitVote(proposal, chainSignatures)
  }

  private async signPause(proposal: Proposal) {
    if (!this.username || !this.activeKey) {
      return
    }
    const chainSignatures = await this.buildChainSignatures(proposal)
    this.submitVote(proposal, chainSignatures)
  }

  private async signUnpause(proposal: Proposal) {
    if (!this.username || !this.activeKey) {
      return
    }
    const chainSignatures = await this.buildChainSignatures(proposal)
    this.submitVote(proposal, chainSignatures)
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
