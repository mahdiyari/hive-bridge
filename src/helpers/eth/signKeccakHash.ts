import { PrivateKey } from 'hive-tx'
import { createWalletClient, http } from '@wevm/viem'
import { bytesToHex } from '@wevm/viem/utils'

/** Sign a message hash and return an ETH signature */
export const signKeccakHash = (msgHash: string) => {
	const ACTIVE_KEY = <string> Deno.env.get('ACTIVE_KEY')
	const keyHex = <`0x${string}`> ('0x' +
		bytesToHex(PrivateKey.from(ACTIVE_KEY).key))
	const account = createWalletClient({
		account: keyHex,
		transport: http(),
	})
	return account.signMessage({ message: msgHash })
	// const signingKey = new ethers.SigningKey(PrivateKey.from(ACTIVE_KEY).key)
	// return signingKey.sign(msgHash).serialized
}
