import { call } from 'hive-tx'
import { config } from 'hive-tx'
import { TransferBody, TransferHistory } from '../helpers/hive/types.ts'
import { isChecksumAddress } from '../helpers/eth/isChecksumAddress.ts'

export class HiveService {
	private MIN_AMOUNT = 1
	private POLLING_INTERVAL = 5_000 // 5s
	private TREASURY = Deno.env.get('TREASURY')
	private lastIrreversibleBlockNum = 0
	private event = new EventTarget()
	private nodeIndex = 0
	private nodes: string[]
	private lastHistoryId = 0
	private genesisBlock

	constructor(genesis: number) {
		this.genesisBlock = genesis
		const nodes = Deno.env.get('HIVE_NODES') || ''
		this.nodes = nodes.split(',')
		config.node = this.nodes
		config.chain_id =
			'4200000000000000000000000000000000000000000000000000000000000000'
		this.processHistory()
	}

	/** Triggers on transfers to the bridge account with valid memo */
	public onTransfer(cb: (detail: TransferBody) => void) {
		this.event.addEventListener('transfer', (e) => {
			const pe = e as CustomEvent
			cb(pe.detail)
		})
	}

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
			const timestamp = new Date(transfers[i][1].timestamp + '.000Z').getTime()
			// We have already proccessed till lastHistoryId
			if (historyId <= this.lastHistoryId || blockNum < this.genesisBlock) {
				continue
			}
			const opBody = transfers[i][1].op[1]
			if (opBody.to !== this.TREASURY) {
				// Outgoing transfers
			}
			if (opBody.to === this.TREASURY) {
				const asset = opBody.amount.split(' ')
				// Accept only amounts >= MIN_AMOUNT HIVE/HBD
				if (
					opBody.memo.startsWith('ETH:') && Number(asset[0]) >= this.MIN_AMOUNT
				) {
					const ethAddress = opBody.memo.substring(4)
					if (isChecksumAddress(ethAddress)) {
						const customEvent = new CustomEvent('transfer', {
							detail: { ...opBody, blockNum, timestamp },
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
			}, this.POLLING_INTERVAL)
		}
	}

	private async getTransferHistory(start = -1, count = 1000) {
		const result = await call('condenser_api.get_account_history', [
			this.TREASURY,
			start,
			count,
			4,
		])
		return <TransferHistory[]> result.result
	}
}
