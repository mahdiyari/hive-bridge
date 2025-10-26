import { PrivateKey } from 'hive-tx'
import { pendingWraps } from './components/PendingWraps'
import { buildHiveTransfer } from './helpers/hive/build_hive_transaction'
import { pendingUnwraps } from './components/PendingUnwraps'
import { configDotenv } from 'dotenv'
import { sleep } from './helpers/sleep'
import { p2pNetwork } from './components/p2p/P2PNetwork'
import { hiveService } from './components/HiveService'
import { ChainServiceInstance } from './helpers/types'
import { logger } from './components/logger'
import { erc20HBD, erc20HIVE } from './components/chains/ethereum/ETHService'

configDotenv({ quiet: true })

// TODO:
// We might want to send signatures out periodically if there is a pending wrap/unwrap
// P2P limit etc might need tuning
// We are still trusting Hive API nodes (the most likely attack vector I think)
// Proxy ETH contract testing but should be simple

const TREASURY = process.env.TREASURY?.replaceAll('"', '')
if (!TREASURY) {
  throw new Error('Missing TREASURY from .env')
}

p2pNetwork.start()
// wait for p2p network
await sleep(5000)
hiveService.start()
erc20HIVE.start()
erc20HBD.start()

const addChainService = (
  chainService: ChainServiceInstance,
  contractSymbol: 'HIVE' | 'HBD'
) => {
  hiveService.onTransfer(async (detail) => {
    const symbol = detail.amount.split(' ')[1]
    if (symbol !== contractSymbol) {
      return
    }
    logger.debug(
      `Detected Hive transfer ${detail.from}:${detail.amount}@${detail.timestamp}`
    )
    const ethAddress = detail.memo.substring(4)
    const { trxId, opInTrx } = detail
    const hasMinted = await chainService.hasMinted(trxId, opInTrx)
    // Convert decimal into integer
    const amount = Number(detail.amount.split(' ')[0]) * 1000
    if (hasMinted) {
      return
    }
    const msgHash = chainService.hashWrapMsg(ethAddress, amount, trxId, opInTrx)
    logger.debug(`Add to pendingWraps ${ethAddress}:${amount}:${trxId}`)
    pendingWraps.addNewWrap(
      chainService.type,
      contractSymbol,
      chainService,
      ethAddress,
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
    const amount = `${(Number(res.amount) / 1000).toFixed(3)} ${
      chainService.symbol
    }`
    const memo = `${chainService.type}:${res.trx}`
    const trx = await buildHiveTransfer(
      TREASURY,
      res.username,
      amount,
      memo,
      res.blockTime * 1000
    )
    await pendingUnwraps.addUnwrap(res.trx, trx)
  })
}

addChainService(erc20HIVE, 'HIVE')
addChainService(erc20HBD, 'HBD')
