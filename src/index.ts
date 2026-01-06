import { pendingWraps } from '@/Wraps'
import { buildHiveTransfer } from '@/utils/hive.utils'
import { pendingUnwraps } from '@/Unwraps'
import { sleep } from '@/utils/sleep'
import { p2pNetwork } from '@/network/P2PNetwork'
import { ChainService } from '@/types/chain.types'
import { logger } from '@/utils/logger'
import { config } from '@/config'
import { addedChainServices } from './blockchain'
import { HiveService } from './blockchain/hive/HiveService'
import { operators } from './network/Operators'
import { Governance } from './governance/Governance'

// TODO:
// P2P limit etc might need tuning
// Proxy ETH contract?

const TREASURY = config.hive.treasury

if (config.hive.operator.username && config.hive.operator.activeKey) {
  logger.info(
    'This node is running as operator by:',
    config.hive.operator.username
  )
}

logger.info(`Treasury Hive account: ${TREASURY}`)

p2pNetwork.start()
// Wait for p2p network
await sleep(5000)
// Wait for operators list to propogate
while (operators.size === 0) {
  await sleep(100)
}
// Ignore the blocks before genesis
const HIVE_GENESIS = config.hive.genesis
const hiveService = new HiveService(HIVE_GENESIS)

// Initialize governance system
new Governance(hiveService)

const addChainService = (chainService: ChainService) => {
  const contractSymbol = chainService.symbol

  hiveService.onTransfer(async (detail) => {
    const symbol = detail.amount.split(' ')[1]
    if (symbol !== contractSymbol) {
      return
    }
    logger.debug(
      `Detected Hive transfer ${detail.from}:${detail.amount}:${
        detail.memo
      }@${new Date(detail.timestamp).toISOString()}`
    )
    const chain = detail.memo.split(':')[0]
    // Memo must start with chain name e.g. 'ETH:0x123...'
    if (chain !== chainService.name) {
      return
    }
    const address = detail.memo.split(':')[1]
    // Validate the provided address
    if (!chainService.isAddress(address)) {
      return
    }
    const { trxId, opInTrx } = detail
    const hasMinted = await chainService.hasMinted(trxId, opInTrx)
    // Convert decimal into integer
    const amount = Number(detail.amount.split(' ')[0]) * 1000
    if (hasMinted) {
      return
    }
    const msgHash = chainService.hashWrapMsg(address, amount, trxId, opInTrx)
    logger.debug(`Add to pendingWraps ${address}:${amount}:${trxId}`)
    pendingWraps.addNewWrap(
      chainService.name,
      contractSymbol,
      chainService,
      address,
      amount,
      trxId,
      opInTrx,
      detail.from,
      msgHash,
      detail.timestamp
    )
  })

  // Handle unwraps
  chainService.onUnwrap(async (res) => {
    logger.debug(`Detected Unwrap ${res.amount}:${res.username}:${res.trx}`)
    const amount = `${(Number(res.amount) / 1000).toFixed(3)} ${
      chainService.symbol
    }`
    const memo = `${chainService.name}:${res.trx}`
    const trx = await buildHiveTransfer(
      TREASURY,
      res.username,
      amount,
      memo,
      res.blockTime * 1000
    )
    await pendingUnwraps.addUnwrap(res.trx, trx)
  })

  // Start the service after adding listeners
  chainService.start()
}

addChainService(addedChainServices.ETHHIVE)
addChainService(addedChainServices.ETHHBD)

// Start hive service afterwards to not miss any transfers
hiveService.start()
