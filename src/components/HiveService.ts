import { call } from 'hive-tx'
import { config } from 'hive-tx'
import { isValidAddress } from 'ethereumjs-util'
import { TransferBody, TransferHistory } from '../helpers/hive/types.ts'

export class HiveService {
	private MIN_AMOUNT = 1
	private lastIrreversibleBlockNum = 0
	private pullInterval = 5_000 // 5s
	private event = new EventTarget()
	private BRIDGE_ACCOUNT = 'pricereport' // Deno.env.get('TREASURY')
	private nodeIndex = 0
	private nodes: string[]
	private lastHistoryId = 0
	private genesisBlock

	constructor(genesis: number) {
		this.genesisBlock = genesis
		const nodes = Deno.env.get('HIVE_NODES') || ''
		this.nodes = nodes.split(',')
		config.node = this.nodes
		this.processHistory()
		// this.startListening()
	}

	/** Triggers on transfers to the bridge account with valid memo */
	public onTransfer(cb: (detail: TransferBody) => void) {
		this.event.addEventListener('transfer', (e) => {
			const pe = e as CustomEvent
			cb(pe.detail)
		})
	}

	// private async callNode(
	// 	method: string,
	// 	params: any[] = [],
	// 	url = this.nodes[this.nodeIndex],
	// 	tries = 0,
	// ): Promise<any> {
	// 	try {
	// 		const body = JSON.stringify({
	// 			id: 2,
	// 			method,
	// 			params,
	// 		})
	// 		const result = await this.fetchWithTimeout(url, body)
	// 		return result
	// 	} catch {
	// 		tries++
	// 		if (tries > 10) {
	// 			throw new Error('Tried too many times for one call')
	// 		}
	// 		this.nodeIndex++
	// 		if (this.nodeIndex > this.nodes.length) {
	// 			this.nodeIndex = 0
	// 		}
	// 		return this.callNode(method, params, this.nodes[this.nodeIndex], tries)
	// 	}
	// }

	// private fetchWithTimeout(url: string, body: string, timeout = 5_000) {
	// 	return new Promise((resolve, reject) => {
	// 		const signal = new AbortController()
	// 		const headers = new Headers()
	// 		headers.set('Content-Type', 'application/json')
	// 		const timer = setTimeout(() => {
	// 			signal.abort()
	// 		}, timeout)
	// 		fetch(url, {
	// 			method: 'post',
	// 			body,
	// 			headers,
	// 			signal: signal.signal,
	// 		})
	// 			.then((res) => res.json())
	// 			.then((res) => resolve(res))
	// 			.catch(() => reject())
	// 			.finally(() => clearTimeout(timer))
	// 	})
	// }

	private async processHistory(count = 1000) {
		let transfers = await this.getTransferHistory(-1, count)
		let len = transfers.length
		// No new items in the history
		if (transfers[len - 1][0] <= this.lastHistoryId) {
			return
		}
		// fetch all items as long as not already processed
		while (
			len === count && transfers[0][0] > this.lastHistoryId &&
			transfers[0][1].block >= this.genesisBlock
		) {
			// history includes the start item as well so we don't want that again
			const start = transfers[0][0] - 1
			const temp = await this.getTransferHistory(start, count)
			len = temp.length
			transfers = temp.concat(transfers)
		}
		for (let i = 0; i < transfers.length; i++) {
			const historyId = transfers[i][0]
			const blockNum = transfers[i][1].block
			// We have already proccessed till lastHistoryId
			if (historyId <= this.lastHistoryId || blockNum < this.genesisBlock) {
				continue
			}
			const opBody = transfers[i][1].op[1]
			if (opBody.to !== this.BRIDGE_ACCOUNT) {
				// Outgoing transfers
			}
			if (opBody.to === this.BRIDGE_ACCOUNT) {
				const asset = opBody.amount.split(' ')
				// Accept only amounts >= MIN_AMOUNT HIVE/HBD
				if (
					opBody.memo.startsWith('ETH:') && Number(asset[0]) >= this.MIN_AMOUNT
				) {
					const ethAddress = opBody.memo.substring(4)
					if (isValidAddress(ethAddress)) {
						const customEvent = new CustomEvent('transfer', {
							detail: { ...opBody, blockNum },
						})
						this.event.dispatchEvent(customEvent)
					}
				}
			}
		}
		this.lastHistoryId = transfers[transfers.length - 1][0]

		// Run only once
		if (count === 1000) {
			setInterval(() => {
				this.processHistory(10)
			}, this.pullInterval)
		}
	}

	// private startListening() {
	// 	// When starting I think we can do account history calls to catch up
	// 	setInterval(() => {
	// 		call('condenser_api.get_dynamic_global_properties').then((res) => {
	// 			if (res?.result) {
	// 				const result = res.result
	// 				const blockNum = result.last_irreversible_block_num
	// 				if (blockNum > this.lastIrreversibleBlockNum) {
	// 					// TODO: Find what was the last processed block and process them here?
	// 					// And somehow prevent block jumping
	// 					this.processBlockNum(blockNum)
	// 					this.lastIrreversibleBlockNum = blockNum
	// 				}
	// 			}
	// 		})
	// 	}, this.pullInterval)
	// }

	private async getTransferHistory(start = -1, count = 1000) {
		const result = await call('condenser_api.get_account_history', [
			this.BRIDGE_ACCOUNT,
			start,
			count,
			4,
		])
		return <TransferHistory[]> result.result
	}

	// private async processBlockNum(blockNum: number) {
	// 	const block = await this.getBlock(blockNum)
	// 	const ops = this.extractOperations(block)
	// 	for (let i = 0; i < ops.length; i++) {
	// 		if (ops[i][0] === 'transfer') {
	// 			const opBody: TransferBody = ops[i][1]
	// 			// We are trusting the RPC node that we are connected to
	// 			// concerns the operators the most
	// 			if (opBody.to === this.BRIDGE_ACCOUNT) {
	// 				const asset = opBody.amount.split(' ')
	// 				// Accept only amounts >= 1 HIVE/HBD
	// 				if (opBody.memo.startsWith('ETH:') && Number(asset[0]) >= 1) {
	// 					const ethAddress = opBody.memo.substring(4)
	// 					if (isValidAddress(ethAddress)) {
	// 						const customEvent = new CustomEvent('transfer', {
	// 							detail: opBody,
	// 						})
	// 						this.event.dispatchEvent(customEvent)
	// 					}
	// 				}
	// 			}
	// 		}
	// 	}
	// }

	// private async getBlock(blockNum: number): Promise<Block> {
	// 	const res = await call('condenser_api.get_block', [blockNum])
	// 	return res.result
	// }

	// private extractOperations(block: Block) {
	// 	const ops = []
	// 	if (block?.transactions && Array.isArray(block.transactions)) {
	// 		const trxs = block.transactions
	// 		for (let i = 0; i < trxs.length; i++) {
	// 			const trx = trxs[i]
	// 			for (let k = 0; k < trx.operations.length; k++) {
	// 				ops.push([trx.operations[k][0], {
	// 					blockNum: trx.block_num,
	// 					...trx.operations[k][1],
	// 				}])
	// 			}
	// 		}
	// 	}
	// 	return ops
	// }
}
