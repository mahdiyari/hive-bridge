import { ethers, EventLog } from 'ethers'
import { hiveContractABI } from '../helpers/eth/hive_contract_abi.ts'

export class ETHService {
	private CONFIRMATIONS = 12
	private POLLING_INTERVAL = 15_000
	private contractAddress: string
	private ethNode: string
	private ethNode2: string | undefined
	private provider: ethers.JsonRpcProvider
	private backupProvider: ethers.JsonRpcProvider | undefined
	private contract: ethers.Contract
	private backupContract: ethers.Contract | undefined
	private lastPolledBlock = 0

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
		if (safeBlock > this.lastPolledBlock) {
			const filter = this.contract.filters.Unwrap()
			const result = await this.contract.queryFilter(
				filter,
				this.lastPolledBlock + 1,
				safeBlock,
			)

			this.lastPolledBlock = safeBlock
		}
	}
	private async startListening() {
		const filter = this.contract.filters.Unwrap()
		const result = await this.contract.queryFilter(
			filter,
			8130370,
			8130370,
		)
		result.forEach(async (res) => {
			const eLog = <EventLog> res
			console.log({
				block: eLog.blockNumber,
				trx: eLog.transactionHash,
				contract: eLog.address,
				args: eLog.args,
				signature: eLog.eventSignature,
			})
			// eLog.getTransaction().then((transaction) => {
			// 	transaction.wait(12).then((trx) => {
			// 		console.log('confirmed', trx)
			// 	})
			// })
		})
	}
}
