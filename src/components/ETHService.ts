import { ethers } from 'ethers'
import { hiveContractABI } from '../helpers/eth/hive_contract_abi.ts'
import { UnwrapEvent } from '../helpers/eth/types.ts'
import { pendingWraps } from './PendingWraps.ts'

export class ETHService {
	private CONFIRMATIONS = 12
	private POLLING_INTERVAL = 20_000
	private contractAddress: string
	private ethNode: string
	private ethNode2: string | undefined
	private provider: ethers.JsonRpcProvider
	private backupProvider: ethers.JsonRpcProvider | undefined
	private contract: ethers.Contract
	private backupContract: ethers.Contract | undefined
	private lastPolledBlock = 0
	private event = new EventTarget()

	/** Takes either wHIVE or wHBD contract address - Both contracts should be identical */
	constructor(contractAddress: string) {
		if (!Deno.env.get('ETH_NODE')) {
			throw new Error('Need a valid ETH API node')
		}
		this.contractAddress = contractAddress
		this.ethNode = <string> Deno.env.get('ETH_NODE')
		this.ethNode2 = Deno.env.get('ETH_NODE2')
		this.provider = new ethers.JsonRpcProvider(this.ethNode)
		this.contract = new ethers.Contract(
			this.contractAddress,
			hiveContractABI,
			this.provider,
		)
		if (this.ethNode2) {
			this.backupProvider = new ethers.JsonRpcProvider(this.ethNode2)
			this.backupContract = new ethers.Contract(
				this.contractAddress,
				hiveContractABI,
				this.backupProvider,
			)
		}
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
		contract = this.contract,
	): Promise<boolean> {
		try {
			const result = await contract.hasMinted(address, blockNum)
			return result
		} catch (e) {
			// on error call the backup node if exists
			if (this.backupContract && contract !== this.backupContract) {
				return this.hasMinted(address, blockNum, this.backupContract)
			}
			throw e
		}
	}

	private async getUnwrapEvents(provider = this.provider) {
		const headBlock = await provider.getBlockNumber()
		const safeBlock = headBlock - this.CONFIRMATIONS
		// We don't need the old data - this should run only the first time
		if (safeBlock - this.lastPolledBlock > 100) {
			this.lastPolledBlock = safeBlock - 100
		}
		if (safeBlock > this.lastPolledBlock) {
			const filter = this.contract.filters.Unwrap()
			const result = await this.contract.queryFilter(
				filter,
				this.lastPolledBlock + 1,
				safeBlock,
			)
			result.forEach(async (res) => {
				const eventLog = <ethers.EventLog> res
				const blockTime = (await eventLog.getBlock()).timestamp
				const customEvent = new CustomEvent('unwrap', {
					detail: {
						blockNum: eventLog.blockNumber,
						blockTime,
						trx: eventLog.transactionHash,
						messenger: eventLog.args[0],
						amount: eventLog.args[1],
						username: eventLog.args[2],
					},
				})
				this.event.dispatchEvent(customEvent)
			})
			this.lastPolledBlock = safeBlock
		}
	}

	private async startListening() {
		setInterval(() => {
			try {
				this.checkPendingWraps()
				this.getUnwrapEvents(this.provider)
			} catch {
				if (this.backupProvider) {
					this.getUnwrapEvents(this.backupProvider)
				}
			}
		}, this.POLLING_INTERVAL)
	}

	// Check and remove already minted pending wraps
	private async checkPendingWraps() {
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
			}
		}
	}
}
