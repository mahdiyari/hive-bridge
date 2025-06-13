import { PrivateKey } from 'hive-tx'
import { createWalletClient, http } from '@wevm/viem'
import { bytesToHex } from '@wevm/viem/utils'
import { sepolia } from '@wevm/viem/chains'
import { privateKeyToAccount } from '@wevm/viem/accounts'

/** Sign a message hash and return an ETH signature */
export const signKeccakHash = (msgHash: `0x${string}`) => {
	const ACTIVE_KEY = <string> Deno.env.get('ACTIVE_KEY')
	const keyHex = bytesToHex(PrivateKey.from(ACTIVE_KEY).key)
	const account = createWalletClient({
		account: privateKeyToAccount(keyHex),
		chain: sepolia,
		transport: http(),
	})
	return account.signMessage({ message: { raw: msgHash } })
	// const signingKey = new ethers.SigningKey(PrivateKey.from(ACTIVE_KEY).key)
	// return signingKey.sign(msgHash).serialized
}
