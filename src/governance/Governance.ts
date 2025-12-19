import { addedChainServices } from '@/blockchain'
import { HiveService } from '@/blockchain/hive/HiveService'
import { config } from '@/config'
import { operators } from '@/network/Operators'
import { TransferBody } from '@/types/hive.types'
import { logger } from '@/utils/logger'
import { PrivateKey } from 'hive-tx'
import { Proposal } from './Proposal'
import { Method, ProposalKey, Signatures } from '@/types/governance.types'
import { getChainMessageHash } from './msgHash'
import { sleep } from '@/utils/sleep'
import { messageList } from '@/network/messageList'

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

  private async getHiveSignature(
    proposal: Proposal,
    retries = 0
  ): Promise<string> {
    if (proposal.created) {
      if (proposal.trx) {
        return proposal.trx.sign(PrivateKey.from(this.activeKey!))
          .signatures[0]!
      } else {
        return ''
      }
    } else {
      if (retries > 60) {
        throw new Error('Failed to create a proposal in 60 tries')
      }
      await sleep(1000)
      return this.getHiveSignature(proposal, retries++)
    }
  }

  private submitVote(proposal: Proposal, signatures: Signatures) {
    proposal.vote(this.username!, signatures)
    const proposalKey: ProposalKey = `${proposal.method}:${proposal.target}`
    messageList.GOVERNANCE({
      operator: this.username!,
      proposalKey,
      signatures,
    })
    logger.info(
      `You voted on proposal:`,
      `${proposal.method}:${proposal.target}`
    )
  }

  private async signProposal(proposal: Proposal) {
    if (!this.username || !this.activeKey) {
      return
    }
    const hiveSignature = await this.getHiveSignature(proposal)
    const chainSignatures = await this.buildChainSignatures(
      proposal,
      hiveSignature
    )
    this.submitVote(proposal, chainSignatures)
  }

  public isPaused(): boolean {
    return this.paused
  }

  private cleanupExpiredProposals() {
    const expiredKeys: string[] = []
    for (const [key, proposal] of proposals) {
      if (proposal.isExpired()) {
        expiredKeys.push(key)
      }
    }
    expiredKeys.forEach((key) => {
      proposals.delete(key as ProposalKey)
      logger.info(`Cleaned up expired proposal: ${key}`)
    })
  }
}
