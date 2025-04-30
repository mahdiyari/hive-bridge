import { ethers } from 'ethers'
import { PrivateKey } from 'hive-tx'

/** Sign a message hash and return an ETH signature */
export const signKeccakHash = (msgHash: string) => {
	const ACTIVE_KEY = <string> Deno.env.get('ACTIVE_KEY')
	const signingKey = new ethers.SigningKey(PrivateKey.from(ACTIVE_KEY).key)
	return signingKey.sign(msgHash).serialized
}
