import { FullMessage } from '../helpers/p2p/types.ts'

export const p2pMessages: Map<string, FullMessage> = new Map()

class PendingHiveWraps {
	private pendingHiveWraps: Map<
		string,
		{
			message: {
				address: string
				amount: number
				blockNum: number
				contract: string
			}
			username: string
			signatures: string[]
			operators: string[]
			timestamp: number
		}
	> = new Map()

	// Keep msgHash for usernames and addresses for retrieving their pending wraps
	private pendingWrapsByAddress: Map<string, string[]> = new Map()
	private pendingWrapsByUsername: Map<string, string[]> = new Map()

	constructor() {
		// Need to remove old pending wraps to prevent excess RAM usage
		// Someone could spam small transfers and increase the size of pendingHiveWraps variable
		// We should prevent < 1 HIVE/HBD wraps to mitigate this
		// 14 days should be safe enough
		const intervalTime = 1_800_000 // 30 minutes
		const cutoff = 14 * 24 * 60 * 60 * 1000 // 14 days
		setInterval(() => {
			const now = Date.now()
			this.pendingHiveWraps.forEach((value, key) => {
				if (value.timestamp < now - cutoff) {
					this.removePendingWrap(key)
				}
			})
		}, intervalTime)
	}

	public addNewWrap(
		address: string,
		amount: number,
		blockNum: number,
		contract: string,
		username: string,
		msgHash: string,
	) {
		this.pendingHiveWraps.set(msgHash, {
			message: {
				address,
				amount,
				blockNum,
				contract,
			},
			username,
			operators: [],
			signatures: [],
			timestamp: Date.now(),
		})
		if (this.pendingWrapsByAddress.has(address)) {
			this.pendingWrapsByAddress.get(address)?.push(msgHash)
		} else {
			this.pendingWrapsByAddress.set(address, [msgHash])
		}
		if (this.pendingWrapsByUsername.has(username)) {
			this.pendingWrapsByUsername.get(username)?.push(msgHash)
		} else {
			this.pendingWrapsByUsername.set(username, [msgHash])
		}
	}

	/** Add a signature to the pending wrap */
	public addSignature(
		msgHash: string,
		signature: string,
		operator: string,
		retry = 1,
	) {
		const wrap = this.pendingHiveWraps.get(msgHash)
		if (wrap) {
			wrap.signatures.push(signature)
			wrap.operators.push(operator)
		} else {
			// Operators could process the Hive blocks faster than us and send signatures
			// Wait and try again one more time
			if (retry) {
				setTimeout(() => {
					this.addSignature(msgHash, signature, operator, 0)
				}, 5_000)
			}
		}
	}

	public getWrapByHash(msgHash: string) {
		return this.pendingHiveWraps.get(msgHash)
	}

	public getWrapsByUsername(username: string) {
		const msgHashs = this.pendingWrapsByUsername.get(username)
		const wraps: any[] = []
		msgHashs?.forEach((hash) => {
			wraps.push(this.pendingHiveWraps.get(hash))
		})
		return wraps
	}

	public getWrapsByAddress(address: string) {
		const msgHashs = this.pendingWrapsByAddress.get(address)
		const wraps: any[] = []
		msgHashs?.forEach((hash) => {
			wraps.push(this.pendingHiveWraps.get(hash))
		})
		return wraps
	}

	public getAllPendingWraps() {
		return this.pendingHiveWraps
	}

	public removePendingWrap(msgHash: string) {
		const wrap = this.pendingHiveWraps.get(msgHash)
		if (wrap) {
			const wrapsByUsername = this.pendingWrapsByUsername.get(wrap.username) ||
				[]
			const wrapsByAddress =
				this.pendingWrapsByAddress.get(wrap.message.address) || []

			if (wrapsByUsername?.length === 1) {
				this.pendingWrapsByUsername.delete(wrap.username)
			} else {
				const temp = []
				for (let i = 0; i < wrapsByUsername.length; i++) {
					if (wrapsByUsername[i] !== msgHash) {
						temp.push(wrapsByUsername[i])
					}
				}
				this.pendingWrapsByUsername.set(wrap.username, temp)
			}

			if (wrapsByAddress?.length === 1) {
				this.pendingWrapsByAddress.delete(wrap.message.address)
			} else {
				const temp = []
				for (let i = 0; i < wrapsByAddress.length; i++) {
					if (wrapsByAddress[i] !== msgHash) {
						temp.push(wrapsByAddress[i])
					}
				}
				this.pendingWrapsByAddress.set(wrap.message.address, temp)
			}

			this.pendingHiveWraps.delete(msgHash)
		}
	}
}

export const pendingWraps = new PendingHiveWraps()
