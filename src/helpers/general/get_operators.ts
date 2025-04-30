import { PublicKey } from 'hive-tx'
import { call } from 'hive-tx'
import { bytesToHex } from '@noble/hashes/utils'
import { ethers } from 'ethers'

/** Operators list updated every 10m - username[] */
export let operators: string[] = []
/** Operators public keys updated every 10m - <username, keys[]> */
export const operatorKeys: Map<string, Array<string>> = new Map()
/** Operators eth addresses updated every 10m - <username, addresses[]> */
export const operatorAddresses: Map<string, Array<string>> = new Map()

const TREASURY = Deno.env.get('TREASURY')
if (!TREASURY) {
	throw new Error('Missing treasury account name')
}

const getOperators = async () => {
	const res = await call('condenser_api.get_accounts', [[TREASURY]])
	const active = res.result[0].active.account_auths
	const temp = []

	for (let i = 0; i < active.length; i++) {
		const username = active[i][0]
		const pubKey = await getOperatorPublicActiveKeys(username)
		temp.push(username)
		const addresses = []
		for (let k = 0; k < pubKey.length; k++) {
			const pkey = PublicKey.from(pubKey[k])
			const hexPubKey = '0x' + bytesToHex(pkey.key)
			addresses.push(ethers.computeAddress(hexPubKey))
		}
		operatorKeys.set(username, pubKey)
		operatorAddresses.set(username, addresses)
	}
	operators = temp
}

// Get and update the operators list, their keys, and eth addresses
// every 10m
getOperators().then(() => {
	console.log('Operators:', operators)
	console.log('Operator eth addresses:', Object.fromEntries(operatorAddresses))
})
setInterval(() => {
	getOperators()
}, 600_000)

const getOperatorPublicActiveKeys = async (operator: string) => {
	const res = await call('condenser_api.get_accounts', [[operator]])
	const active = res.result[0].active.key_auths
	const pubKeys: string[] = []
	for (let i = 0; i < active.length; i++) {
		pubKeys.push(active[i][0])
	}
	return pubKeys
}
