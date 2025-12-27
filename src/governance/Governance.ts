import { addedChainServices } from '@/blockchain'
import { HiveService } from '@/blockchain/hive/HiveService'
import { config } from '@/config'
import { operators } from '@/network/Operators'
import { TransferBody } from '@/types/hive.types'
import { logger } from '@/utils/logger'
import { PrivateKey } from 'hive-tx'
import { Proposal } from './Proposal'
import { ChainSymbolKey, Method, ProposalKey } from '@/types/governance.types'
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
const chains: ChainSymbolKey[] = ['ETHHIVE', 'ETHHBD', 'HIVE']

export const proposals: Map<ProposalKey, Proposal> = new Map()

export class Governance {
  private readonly CLEANUP_INTERVAL_MINUTES = 10
  private readonly STALE_ACTION_DAYS = 1

  private hive: HiveService
  private paused: boolean = false
  private username = config.hive.operator.username
  private activeKey = config.hive.operator.activeKey
  private isOperator = this.username && this.activeKey ? true : false

  constructor(hive: HiveService) {
    this.hive = hive

    setInterval(
      () => this.cleanupExpiredProposals(),
      this.CLEANUP_INTERVAL_MINUTES * 60 * 1000
    )

    this.hive.onTransfer(async (transfer: TransferBody) => {
      // Is sender an operator?
      if (!operators.get(transfer.from)) {
        return
      }
      if (!transfer.memo || transfer.memo.length === 0) {
        return
      }
      if (
        Date.now() - transfer.timestamp >
        this.STALE_ACTION_DAYS * 24 * 60 * 60 * 1000
      ) {
        return
      }
      // governance:HIVEETH:start:add-signer:mahdiyari:0
      // "governance:ETHHIVE:start:method:target:nonce"
      // "governance:HIVE:start:method:target"
      // "governance:ETHHIVE:vote:method:target:blockNum"
      // e.g. "governance:start:add-signer:mahdiyari:1"
      // e.g. "governance:vote:add-signer:mahdiyari:50000000"
      const memoParts = transfer.memo.split(':')
      if (memoParts.length !== 6) {
        return
      }
      if (memoParts[0] !== 'governance') {
        return
      }
      const chain = memoParts[1] as ChainSymbolKey
      if (!chains.includes(chain)) {
        return
      }
      const action = memoParts[2] as ProposalAction
      if (!proposalActions.includes(action)) {
        return
      }
      const method = memoParts[3] as Method
      if (!methods.includes(method)) {
        return
      }
      const target = memoParts[4]
      // It is nonce when action = start and blockNum when vote
      let nonceOrBlockNum = Number(memoParts[5])
      if (isNaN(nonceOrBlockNum)) {
        return
      }
      let proposalKey: ProposalKey = `${chain}:${method}:${target}:${
        action === 'start' ? transfer.blockNum : nonceOrBlockNum
      }`
      if (action === 'start') {
        if (proposals.has(proposalKey)) {
          logger.warning(
            'Got a transfer to start a proposal but it is already started:',
            proposalKey
          )
          return
        }
        if (method === 'pause' || method === 'unpause') {
          if (chain === 'HIVE') {
            logger.warning(
              `Got a proposal start for unsupport method ${method} on HIVE chain`
            )
            return
          }
          if (target !== 'null') {
            logger.warning(
              `Got invalid start proposal: target must be "null" for pause and unpause`
            )
            return
          }
        }
        if (chain !== 'HIVE') {
          // skip already executed proposals on chains
          // on hive, the transaction id is unique so we will check that later
          const currentNonce = await addedChainServices[chain].getNonce(method)
          if (currentNonce !== nonceOrBlockNum) {
            return
          }
        } else {
          // nonce must be 0 for HIVE
          if (nonceOrBlockNum !== 0) {
            return
          }
        }
        const proposal = new Proposal(
          chain,
          method,
          transfer.timestamp,
          transfer.blockNum,
          target,
          nonceOrBlockNum
        )
        proposals.set(proposalKey, proposal)
        logger.info(`Started proposal: ${proposalKey} by ${transfer.from}`)
        if (this.isOperator) {
          this.signProposal(proposal)
        }
        // If we started the node later, we won't be receiving signatures
        // So ask for signatures
        messageList.REQUEST_GOVERNANCE(proposalKey)
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

  private async getHiveSignature(
    proposal: Proposal,
    retries = 0
  ): Promise<string | null> {
    if (proposal.created) {
      if (proposal.trx) {
        return proposal.trx.sign(PrivateKey.from(this.activeKey!))
          .signatures[0]!
      } else {
        return null
      }
    } else {
      if (retries > 60) {
        throw new Error('Failed to create a proposal in 60 tries')
      }
      await sleep(1000)
      return this.getHiveSignature(proposal, retries++)
    }
  }

  private submitVote(proposal: Proposal, signature: string) {
    proposal.vote(this.username!, signature)
    const proposalKey: ProposalKey = proposal.proposalKey
    messageList.GOVERNANCE({
      operator: this.username!,
      proposalKey,
      signature,
    })
    logger.info(`You voted on proposal:`, proposalKey)
  }

  private async signProposal(proposal: Proposal) {
    if (!this.username || !this.activeKey) {
      return
    }
    try {
      let signature
      if (proposal.chain === 'HIVE') {
        signature = await this.getHiveSignature(proposal)
      } else {
        signature = await getChainMessageHash(
          addedChainServices[proposal.chain],
          proposal,
          true
        )
      }
      if (signature) {
        this.submitVote(proposal, signature)
      }
    } catch (e) {
      logger.warning(
        `Signing proposal ${proposal.method}:${proposal.target} failed`,
        e
      )
    }
  }

  public isPaused(): boolean {
    return this.paused
  }

  private async cleanupExpiredProposals() {
    const toRemove: string[] = []
    for (const [key, proposal] of proposals) {
      if (proposal.isExpired()) {
        toRemove.push(key)
      } else if (await proposal.isDone()) {
        toRemove.push(key)
      }
    }
    toRemove.forEach((key) => {
      proposals.delete(key as ProposalKey)
      logger.info(`Cleaned up expired proposal: ${key}`)
    })
  }
}
