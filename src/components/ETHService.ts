import { hiveContractABI } from '../helpers/eth/hive_contract_abi.ts'
import { UnwrapEvent } from '../helpers/eth/types.ts'
import { pendingWraps } from './PendingWraps.ts'
import { withTimeout } from '../helpers/general/with_timeout.ts'
import { createPublicClient, getContract, http, PublicClient } from '@wevm/viem'
import { sepolia } from '@wevm/viem/chains'
import { sleep } from '../helpers/general/sleep.ts'

export class ETHService {
	private CONFIRMATIONS = 12n
	private POLLING_INTERVAL = 20_000
	private contractAddress: string
	private ethNode: string
	// private ethNode2: string | undefined
	private client: PublicClient
	private contract
	private lastPolledBlock = 0n
	private event = new EventTarget()

	/** Takes either wHIVE or wHBD contract address - Both contracts should be identical */
	constructor(contractAddress: `0x${string}`) {
		if (!Deno.env.get('ETH_NODE')) {
			throw new Error('Need a valid ETH API node')
		}
		this.contractAddress = contractAddress
		this.ethNode = <string> Deno.env.get('ETH_NODE')
		this.client = createPublicClient({
			chain: sepolia,
			transport: http(this.ethNode),
		})
		this.contract = getContract({
			address: contractAddress,
			abi: hiveContractABI,
			client: this.client,
		})
		this.startListening()
	}

	/** Triggers on unwrap events */
	public onUnwrap(cb: (detail: UnwrapEvent) => void) {
		this.event.addEventListener('unwrap', (e) => {
			const pe = e as CustomEvent
			cb(pe.detail)
		})
	}

	/** Every ETH address can only mint once per Hive blockNum and contract keeps track of that */
	public async hasMinted(
		address: string,
		blockNum: number,
	): Promise<boolean> {
		try {
			// const result = await withTimeout(
			// 	contract.hasMinted(address, blockNum),
			// 	5000,
			// )
			const result = <boolean> await this.contract.read.hasMinted([
				address,
				blockNum,
			])
			return result
		} catch (e) {
			// TODO: disable backup node for now
			// on error call the backup node if exists
			// if (this.backupContract && contract !== this.backupContract) {
			// 	return this.hasMinted(address, blockNum, this.backupContract)
			// }
			console.log('Error in hasMinted:')
			throw e
		}
	}

	private async getUnwrapEvents() {
		try {
			const headBlock: bigint = await this.client.getBlockNumber()
			const safeBlock = headBlock - this.CONFIRMATIONS
			// We don't need the old data - this should run only the first time
			if (safeBlock - this.lastPolledBlock > 100n) {
				this.lastPolledBlock = safeBlock - 100n
			}
			if (safeBlock > this.lastPolledBlock) {
				const unwraps = await this.contract.getEvents.Unwrap({
					fromBlock: this.lastPolledBlock + 1n,
					toBlock: safeBlock,
				})
				for (let i = 0; i < unwraps.length; i++) {
					const block = await this.client.getBlock({
						blockNumber: unwraps[i].blockNumber,
					})
					const blockTime = Number(block.timestamp)
					if ('args' in unwraps[i]) {
						const customEvent = new CustomEvent('unwrap', {
							detail: {
								blockNum: unwraps[i].blockNumber,
								blockTime,
								trx: unwraps[i].transactionHash,
								...unwraps[i].args, // {messenger, amount, username}
							},
						})
						this.event.dispatchEvent(customEvent)
					}
				}
				this.lastPolledBlock = safeBlock
			}
		} catch {
			//
		}
	}

	private startListening() {
		setInterval(async () => {
			try {
				await this.checkPendingWraps()
				await this.getUnwrapEvents()
			} catch {
				// if (this.backupProvider) {
				// 	this.getUnwrapEvents(this.backupProvider).catch(() => {})
				// }
			}
		}, this.POLLING_INTERVAL)
	}

	// Check and remove already minted pending wraps
	private async checkPendingWraps() {
		try {
			const wraps = pendingWraps.getAllPendingWraps()
			for (const [key, value] of wraps) {
				if (this.contractAddress === value.message.contract) {
					const minted = await this.hasMinted(
						value.message.address,
						value.message.blockNum,
					)
					if (minted) {
						pendingWraps.removePendingWrap(key)
					}
					sleep(100) // prevent rate-limiting - another method might be better
				}
			}
		} catch {
			//
		}
	}
}
