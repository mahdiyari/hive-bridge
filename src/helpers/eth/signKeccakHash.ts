import { ethers } from 'ethers'
import { PrivateKey } from 'hive-tx'

/** Sign a message hash and return an ETH signature */
export const signKeccakHash = async (msgHash: string) => {
  const ACTIVE_KEY = <string>process.env.ACTIVE_KEY?.replaceAll('"', '')
  const signingKey = new ethers.SigningKey(PrivateKey.from(ACTIVE_KEY).key)
  return signingKey.sign(msgHash).serialized
}
