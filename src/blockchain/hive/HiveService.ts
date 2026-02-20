import { callWithQuorum, config as configHiveTx } from 'hive-tx'
import { TransferBody, TransferHistory } from '@/types/hive.types'
import { config } from '@/core/config'
import { logger } from '@/utils/logger'

export class HiveService {
  private readonly POLLING_INTERVAL = 5_000
  private readonly TREASURY = config.hive.treasury
  private readonly HISTORY_BATCH_SIZE = 1000
  private readonly HISTORY_POLLING_SIZE = 10
  private readonly event = new EventTarget()
  private readonly nodes = config.hive.nodes
  private readonly genesisBlock = config.hive.genesis
  private lastHistoryId = 0

  constructor() {
    configHiveTx.nodes = this.nodes
  }

  /** Start HiveService and begin polling for transfer history */
  public start() {
    setInterval(() => {
      this.processHistory(this.HISTORY_POLLING_SIZE)
    }, this.POLLING_INTERVAL)
  }

  /** Triggers on transfers to the bridge account with valid memo */
  public onTransfer(cb: (detail: TransferBody) => void) {
    this.event.addEventListener('transfer', (e) => {
      const pe = e as CustomEvent
      cb(pe.detail)
    })
  }

  public signGovernanceMessage() {}

  /**
   * Process account history to detect incoming transfers
   * Fetches historical transfers and dispatches events for new ones
   * @param count - Number of history items to fetch (defaults to batch size on first run)
   */
  private async processHistory(count?: number) {
    try {
      const batchSize = count ?? this.HISTORY_BATCH_SIZE
      let transfers = await this.getTransferHistory(-1, batchSize)
      let len = transfers.length
      if (!transfers || !len) {
        return
      }
      // No new items in the history
      if (transfers[len - 1][0] <= this.lastHistoryId) {
        return
      }
      // Fetch all items as long as not already processed
      while (
        len === batchSize &&
        transfers[0][0] > this.lastHistoryId &&
        transfers[0][1].block >= this.genesisBlock
      ) {
        // History includes the start item as well so we don't want that again
        const start = transfers[0][0] - 1
        const temp = await this.getTransferHistory(start, batchSize)
        len = temp.length
        transfers = temp.concat(transfers)
      }
      for (let i = 0; i < transfers.length; i++) {
        const historyId = transfers[i][0]
        const blockNum = transfers[i][1].block
        const timestamp = new Date(
          transfers[i][1].timestamp + '.000Z'
        ).getTime()
        //  Skip transfers older than cutoff
        if (Date.now() - timestamp > config.general.wrapCutoff) {
          continue
        }
        const trxId = transfers[i][1].trx_id
        const opInTrx = transfers[i][1].op_in_trx
        // We have already processed till lastHistoryId
        if (historyId <= this.lastHistoryId || blockNum < this.genesisBlock) {
          continue
        }
        const opBody = transfers[i][1].op[1]
        if (opBody.to !== this.TREASURY) {
          // Outgoing transfers - ignore for now
        }
        if (opBody.to === this.TREASURY) {
          const transferBody = {
            ...opBody,
            blockNum,
            timestamp,
            trxId,
            opInTrx,
          }
          const customEvent = new CustomEvent('transfer', {
            detail: transferBody,
          })
          this.event.dispatchEvent(customEvent)
        }
      }
      this.lastHistoryId = transfers[transfers.length - 1][0]
    } catch (e) {
      logger.debug('Possibly a network error when fetching Hive history:', e)
    }
  }

  private async getTransferHistory(start = -1, count = 1000) {
    const result = await callWithQuorum('condenser_api.get_account_history', [
      this.TREASURY,
      start,
      count,
      4,
    ])
    return <TransferHistory[]>result || []
  }
}
