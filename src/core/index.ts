import { pendingWraps } from '@/core/Wraps'
import { buildHiveTransfer, getAccount } from '@/utils/hive.utils'
import { pendingUnwraps } from '@/core/Unwraps'
import { sleep } from '@/utils/time.utils'
import { p2pNetwork } from '@/network/P2PNetwork'
import { ChainService } from '@/types/chain.types'
import { logger } from '@/utils/logger'
import { config } from '@/core/config'
import { addedChainServices } from '../blockchain'
import { HiveService } from '../blockchain/hive/HiveService'
import { operators } from '../network/Operators'
import { Governance } from '../governance/Governance'

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

const hiveService = new HiveService()

// Initialize governance system
new Governance(hiveService)

const addChainService = (chainService: ChainService) => {
  const contractSymbol = chainService.symbol
  // Handle wraps
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
    // Convert decimal into integer
    const amount = Number(detail.amount.split(' ')[0]) * 1000
    // Do not process amounts lower than minimum
    if (amount < config.general.minimumWrapAmount * 1000) {
      return
    }
    const chainName = detail.memo.split(':')[0].trim()
    // Memo must start with chain name e.g. 'ETH:0x123...'
    if (chainName.toLowerCase() !== chainService.name.toLowerCase()) {
      return
    }
    const address = detail.memo.split(':')[1].trim()
    // Validate the provided address
    if (!chainService.isAddress(address)) {
      return
    }
    const { trxId, opInTrx } = detail
    const hasMinted = await chainService.hasMinted(trxId, opInTrx)
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
    // Validate account
    const targetUsername = res.username.toLowerCase()
    try {
      if (targetUsername.length < 3 && targetUsername.length > 16) {
        return
      }
      const account = await getAccount(targetUsername)
      if (account?.name !== targetUsername) {
        return
      }
    } catch {
      return
    }
    const amount = `${(Number(res.amount) / 1000).toFixed(3)} ${
      chainService.symbol
    }`
    const memo = `${chainService.name}:${res.trx}`
    const trx = await buildHiveTransfer(
      TREASURY,
      targetUsername,
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
