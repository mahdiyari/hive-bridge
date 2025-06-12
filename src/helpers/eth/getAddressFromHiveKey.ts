import { PublicKey } from 'hive-tx'
import { Point } from '@noble/secp256k1'
import { bytesToHex, publicKeyToAddress } from '@wevm/viem/utils'

export const getAddressFromHiveKey = (hivePublicKey: string) => {
	const keyHex = bytesToHex(PublicKey.from(hivePublicKey).key)
	const uncompressedKey = Point.fromHex(keyHex.slice(2)).toHex(false)
	return publicKeyToAddress(`0x${uncompressedKey}`)
}
