import { PrivateKey } from 'hive-tx'
import { sha256 } from '@noble/hashes/sha256'
import { Signature } from 'hive-tx'
import { operators } from '../../components/Operators.ts'

interface Heartbeat {
	operator: string
	peerId: string
	timestamp: number
}

interface SignedHeartbeat extends Heartbeat {
	signature: string
}

export const signHeartbeat = (msg: Heartbeat, key: PrivateKey) => {
	const hash = sha256(JSON.stringify(msg))
	return key.sign(hash).customToString()
}

export const validateHeartbeat = (msg: SignedHeartbeat) => {
	try {
		// Reject older than 10s messages
		if (Date.now() - msg.timestamp > 10_000) {
			return false
		}
		if (!operators.getOperators().includes(msg.operator)) {
			return false
		}
		const signature = Signature.from(msg.signature)
		const rawMsg: Heartbeat = {
			operator: msg.operator,
			peerId: msg.peerId,
			timestamp: msg.timestamp,
		}
		const hash = sha256(JSON.stringify(rawMsg))
		const recoveredKey = signature.getPublicKey(hash).toString()
		const opKeys = operators.getOperatorKeys(msg.operator)
		opKeys?.forEach((value) => {
			if (value === recoveredKey) {
				return true
			}
		})
		return false
	} catch {
		return false
	}
}
