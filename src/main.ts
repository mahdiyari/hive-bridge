import { P2PNetwork } from './components/P2PNetwork.ts'
import { HiveService } from './components/HiveService.ts'
import { ethers } from 'ethers'
import { PrivateKey } from 'hive-tx'
import { pendingWraps } from './components/PendingHiveWraps.ts'
import { call } from 'hive-tx'
import { PublicKey } from 'hive-tx'
import { bytesToHex } from '@noble/hashes/utils'
import { app } from './components/APIServer.ts'
import { ETHService } from './components/ETHService.ts'

const HIVE_ETH_CONTRACT = '0xfC247E0A2Cf57F0aC49622Da944B0C5B84C0f2a1'
const HBD_ETH_CONTRACT = '0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5'

// Update this upon contract change while testing
const HIVE_GENESIS = 92050254

// Example usage:
const port1 = 8080
const port2 = 8081

const knownPeers1 = [`localhost:${port2}`]
const knownPeers2 = [`localhost:${port1}`]

const hashKeccak256 = (
	address: string,
	amount: number,
	blockNum: number,
	contract: string,
) => {
	return ethers.keccak256(
		ethers.solidityPacked([
			'address',
			'string',
			'uint64',
			'string',
			'uint32',
			'string',
			'address',
		], [address, ';', amount, ';', blockNum, ';', contract]),
	)
}

const main = () => {
	const USERNAME = Deno.env.get('USERNAME')
	const ACTIVE_KEY = Deno.env.get('ACTIVE_KEY')
	let isOperator = false
	if (USERNAME && ACTIVE_KEY) {
		isOperator = true
	}

	// Start the p2p network
	const network = new P2PNetwork(knownPeers1, port1)
	network.onMessage(async (detail) => {
		console.log('message:', detail)
		// Check pendingHiveWraps and add signature there
		if (detail.data.type === 'SIGNATURE') {
			const data = detail.data.data
			const msg = data.message
			const msgHash = hashKeccak256(
				msg.address,
				msg.amount,
				msg.blockNum,
				msg.contract,
			)
			const isValid = await validateSignature(
				data.operator,
				msgHash,
				data.signature,
			)
			if (isValid) {
				pendingWraps.addSignature(msgHash, data.signature, data.operator)
			}
		}
	})

	// Start Hive service
	const hive = new HiveService(HIVE_GENESIS)
	hive.onTransfer(async (detail) => {
		// console.log('transfer:', detail)
		const symbol = detail.amount.split(' ')[1]
		const ethAddress = detail.memo.substring(4)
		// console.log(ethAddress)
		if (symbol === 'HIVE') {
			// Remove the decimals from amount
			const amount = Number(detail.amount.replace(' HIVE', '')) * 1000
			const blockNum = detail.blockNum
			const hasMinted = await whive.hasMinted(ethAddress, blockNum)
			if (hasMinted) {
				return
			}
			// Hash and sign (address+amount+blocknum+contractaddr)
			// This means one address can bridge once per block
			// We could use trxid for uniqueness instead of blocknum but that takes more storage (gas)
			// Include contract address to avoid multi contract replay attacks
			const msg = ethAddress + ';' + amount + ';' + blockNum + ';' +
				HIVE_ETH_CONTRACT
			const msgHash = hashKeccak256(
				ethAddress,
				amount,
				blockNum,
				HIVE_ETH_CONTRACT,
			)
			// Add to the list of pendingHiveWraps
			pendingWraps.addNewWrap(
				ethAddress,
				amount,
				blockNum,
				HIVE_ETH_CONTRACT,
				detail.from,
				msgHash,
			)

			if (isOperator && USERNAME) {
				const signature = signKeccakHash(msgHash)
				pendingWraps.addSignature(msgHash, signature, USERNAME)
				network.sendSignature(USERNAME, msgHash, signature)
			}
		}
	})
	// Start ETH service
	const whive = new ETHService(HIVE_ETH_CONTRACT)

	app.listen({ port: 8000 })
	console.log('API server listening on 8000')
}
main()

/** Sign a message hash and return an ETH signature */
const signKeccakHash = (msgHash: string) => {
	const ACTIVE_KEY = <string> Deno.env.get('ACTIVE_KEY')
	const signingKey = new ethers.SigningKey(PrivateKey.from(ACTIVE_KEY).key)
	return signingKey.sign(msgHash).serialized
}

const validateSignature = async (
	operator: string,
	msgHash: string,
	signature: string,
) => {
	const opAddresses = await getOperatorAddresses(operator)
	const recoveredAddress = ethers.recoverAddress(msgHash, signature)
	for (let i = 0; i < opAddresses.length; i++) {
		if (opAddresses[i] === recoveredAddress) {
			return true
		}
	}
	return false
}

const getOperatorAddresses = async (operator: string) => {
	const res = await call('condenser_api.get_accounts', [[operator]])
	const active = res.result[0].active.key_auths
	const addresses = []
	for (let i = 0; i < active.length; i++) {
		const pubKey = PublicKey.from(active[i][0])
		const hexPubKey = '0x' + bytesToHex(pubKey.key)
		addresses.push(ethers.computeAddress(hexPubKey))
	}
	return addresses
}
