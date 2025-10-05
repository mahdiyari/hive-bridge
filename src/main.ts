import { P2PNetwork } from './components/P2PNetwork'
import { HiveService } from './components/HiveService'
import { PrivateKey } from 'hive-tx'
import { pendingWraps } from './components/PendingWraps'
// import { app } from './components/APIServer'
import { ETHService } from './components/ETHService'
import { buildHiveTransfer } from './helpers/hive/build_hive_transaction'
import { pendingUnwraps } from './components/PendingUnwraps'
import { hashWrapMessage } from './helpers/eth/hashWrapMessage'
import { signKeccakHash } from './helpers/eth/signKeccakHash'
import { configDotenv } from 'dotenv'
import { sleep } from './helpers/general/sleep'

configDotenv({ quiet: true })

// TODO:
// We might want to send signatures out periodically if there is a pending wrap/unwrap
// P2P limit etc might need tuning
// We are still trusting Hive API nodes (the most likely attack vector I think)
// Proxy ETH contract testing but should be simple

const HIVE_ETH_CONTRACT = '0xaad1Ae20630991D477539A1abC438F3f4d430197'
// const HIVE_ETH_CONTRACT = '0xdbDa07F0BcD6E241a7B892B6B1fE31488c13A5df'
const HBD_ETH_CONTRACT = '0x7FFaDa633d2018Af1cf07D15002e5360C3e71855'

// Update this upon contract change while testing
const HIVE_GENESIS = 95507645

const TREASURY = process.env.TREASURY?.replaceAll('"', '')
if (!TREASURY) {
  throw new Error('Missing TREASURY from .env')
}

const port1 = 8080
const knownPeers1 = [`localhost:8081`]

const USERNAME = process.env.USERNAME?.replaceAll('"', '')
const ACTIVE_KEY = process.env.ACTIVE_KEY?.replaceAll('"', '')
let isOperator = false
if (USERNAME && ACTIVE_KEY) {
  isOperator = true
}

// We start 3 services
// P2PNetwork to handle the p2p messaging
// HiveService to read Hive transactions
// ETHService to read ETH transactions
const main = async () => {
  const p2pNetwork = new P2PNetwork()
  await sleep(5000)
  const hiveService = new HiveService(HIVE_GENESIS)
  const whiveService = new ETHService(HIVE_ETH_CONTRACT)
  const whbdService = new ETHService(HBD_ETH_CONTRACT)

  p2pNetwork.onMessage((detail) => {
    console.log('message:', detail)
    if (detail.data.type === 'ETH_SIGNATURE') {
      // Received an ETH signature from peers for pendingWraps (minting ERC20)
      const data = detail.data.data
      const msg = data.message
      const msgHash = hashWrapMessage(
        msg.address,
        msg.amount,
        msg.blockNum,
        msg.contract
      )
      // validate and add signature
      pendingWraps.addSignature(msgHash, data.signature, data.operator)
    }
    if (detail.data.type === 'HIVE_SIGNATURE') {
      // Received a Hive signature from peers for pendingUnwraps
      const data = detail.data.data
      const msg = data.message
      // Verify and add the signature
      pendingUnwraps.addSignature(
        data.operator,
        msg.ethTransactionHash,
        data.signature
      )
    }
  })

  hiveService.onTransfer(async (detail) => {
    console.log(detail)
    const symbol = detail.amount.split(' ')[1]
    const ethAddress = detail.memo.substring(4)
    let hasMinted = true
    // Remove the decimals from amount
    const amount = Number(detail.amount.split(' ')[0]) * 1000
    const blockNum = detail.blockNum
    let contractAddress = HIVE_ETH_CONTRACT
    if (symbol === 'HIVE') {
      hasMinted = await whiveService.hasMinted(ethAddress, blockNum)
    } else {
      hasMinted = await whbdService.hasMinted(ethAddress, blockNum)
      contractAddress = HBD_ETH_CONTRACT
    }
    if (hasMinted) {
      return
    }
    const msgHash = hashWrapMessage(
      ethAddress,
      amount,
      blockNum,
      contractAddress
    )
    console.log('add to pending wraps')
    // Add to the list of pendingWraps
    pendingWraps.addNewWrap(
      ethAddress,
      amount,
      blockNum,
      contractAddress,
      detail.from,
      msgHash,
      detail.timestamp
    )
    // If we are operator, sign and broadcast our signature
    if (isOperator && USERNAME) {
      const signature = await signKeccakHash(msgHash)
      pendingWraps.addSignature(msgHash, signature, USERNAME)
      p2pNetwork.sendSignature(USERNAME, msgHash, signature)
      // TODO: should do this only if not enough sigs found
      const myInterval = setInterval(() => {
        const wrap = pendingWraps.getWrapByHash(msgHash)
        if (!wrap || Date.now() - wrap?.timestamp > 300_000) {
          clearInterval(myInterval)
        } else {
          p2pNetwork.sendSignature(USERNAME, msgHash, signature)
        }
      }, 10_000)
    }
  })

  whiveService.onUnwrap((res) => {
    // We received an unwrap event
    // i.e. someone has burned their WHIVE
    const amount = `${(Number(res.amount) / 1000).toFixed(3)} HIVE` // HIVE
    handleUnwrap(res.trx, res.username, amount, res.blockTime)
  })

  whbdService.onUnwrap((res) => {
    // We received an unwrap event
    // i.e. someone has burned their WHBD
    const amount = `${(Number(res.amount) / 1000).toFixed(3)} HBD` // HBD
    handleUnwrap(res.trx, res.username, amount, res.blockTime)
  })

  const handleUnwrap = async (
    trxHash: string,
    username: string,
    amount: string,
    blockTime: number
  ) => {
    const memo = `ETH:${trxHash}`
    const trx = await buildHiveTransfer(
      TREASURY,
      username,
      amount,
      memo,
      blockTime * 1000
    )
    await pendingUnwraps.addUnwrap(trxHash, trx)
    // If we are operator, sign and broadcast our signature
    if (isOperator && ACTIVE_KEY && USERNAME) {
      const privateKey = PrivateKey.from(ACTIVE_KEY)
      const sig = privateKey.sign(trx.digest().digest)
      p2pNetwork.sendHiveSignature(USERNAME, trxHash, sig.customToString())
      pendingUnwraps.addSignature(USERNAME, trxHash, sig.customToString())
      const myInterval = setInterval(() => {
        const unwrap = pendingUnwraps.getUnwrap(trxHash)
        if (unwrap) {
          p2pNetwork.sendHiveSignature(USERNAME, trxHash, sig.customToString())
        } else {
          clearInterval(myInterval)
        }
      }, 10_000)
    }
  }

  // const port = Number(process.env.API_PORT) || 8000
  // app.listen({ port })
  // console.log(`API server listening on ${port}`)
}
main()
