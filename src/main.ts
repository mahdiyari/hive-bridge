import { P2PNetwork } from './components/P2PNetwork.ts'
import { HiveService } from './components/HiveService.ts'
import { PrivateKey } from 'hive-tx'
import { pendingWraps } from './components/PendingWraps.ts'
import { app } from './components/APIServer.ts'
import { ETHService } from './components/ETHService.ts'
import { buildHiveTransfer } from './helpers/hive/build_hive_transaction.ts'
import { pendingUnwraps } from './components/PendingUnwraps.ts'
import { hashWrapMessage } from './helpers/eth/hashWrapMessage.ts'
import { signKeccakHash } from './helpers/eth/signKeccakHash.ts'

// TODO:
// We might want to send signatures out periodically if there is a pending wrap/unwrap
// P2P limit etc might need tuning
// ETH connections "should" be fine but there was a node:http error without a fucking trace to where that error happened so watchout for that
// We are still trusting Hive API nodes (the most likely attack vector I think)
// Proxy ETH contract testing but should be simple

const HIVE_ETH_CONTRACT = '0x216D8Ff7F1047FeEea2104D8051Ae4f2C2BA0578'
// const HIVE_ETH_CONTRACT = '0xdbDa07F0BcD6E241a7B892B6B1fE31488c13A5df'
const HBD_ETH_CONTRACT = '0x180099e000B20AC13b91A7863a8210272B411f82'

// Update this upon contract change while testing
const HIVE_GENESIS = 95507645

const TREASURY = Deno.env.get('TREASURY')
if (!TREASURY) {
	throw new Error('Missing TREASURY from .env')
}

const port1 = 8080
const knownPeers1 = [`localhost:8081`]

const USERNAME = Deno.env.get('USERNAME')
const ACTIVE_KEY = Deno.env.get('ACTIVE_KEY')
let isOperator = false
if (USERNAME && ACTIVE_KEY) {
	isOperator = true
}

// We start 3 services
// P2PNetwork to handle the p2p messaging
// HiveService to read Hive transactions
// ETHService to read ETH transactions
const main = () => {
	const p2pNetwork = new P2PNetwork()
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
				msg.contract,
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
				data.signature,
			)
		}
	})

	hiveService.onTransfer(async (detail) => {
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
			contractAddress,
		)
		// Add to the list of pendingWraps
		pendingWraps.addNewWrap(
			ethAddress,
			amount,
			blockNum,
			contractAddress,
			detail.from,
			msgHash,
			detail.timestamp,
		)
		// If we are operator, sign and broadcast our signature
		if (isOperator && USERNAME) {
			const signature = signKeccakHash(msgHash)
			pendingWraps.addSignature(msgHash, signature, USERNAME)
			p2pNetwork.sendSignature(USERNAME, msgHash, signature)
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
		blockTime: number,
	) => {
		const memo = `ETH:${trxHash}`
		const trx = await buildHiveTransfer(
			TREASURY,
			username,
			amount,
			memo,
			blockTime * 1000,
		)
		await pendingUnwraps.addUnwrap(trxHash, trx)
		// If we are operator, sign and broadcast our signature
		if (isOperator && ACTIVE_KEY && USERNAME) {
			const privateKey = PrivateKey.from(ACTIVE_KEY)
			const sig = privateKey.sign(trx.digest().digest)
			p2pNetwork.sendHiveSignature(USERNAME, trxHash, sig.customToString())
			pendingUnwraps.addSignature(USERNAME, trxHash, sig.customToString())
		}
	}

	const port = Number(Deno.env.get('API_PORT')) || 8000
	app.listen({ port })
	console.log(`API server listening on ${port}`)
}
main()
