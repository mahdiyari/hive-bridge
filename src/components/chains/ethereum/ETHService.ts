import { ethers } from 'ethers'
import { ethContractABI } from './ethContractABI'
import { ChainServiceInstance, UnwrapEvent } from '../../../helpers/types'
import { withTimeout } from '../../../helpers/general/with_timeout'
import { PrivateKey } from 'hive-tx'
import { logger } from '../../logger'
import { configDotenv } from 'dotenv'
import { ChainType } from '../../p2p/helpers/types'

class ETHService {
  private CONFIRMATIONS = 12
  private POLLING_INTERVAL = 20_000
  private ethNode: string
  private ethNode2: string | undefined
  private provider: ethers.JsonRpcProvider
  private backupProvider: ethers.JsonRpcProvider | undefined
  private contract: ethers.Contract
  private backupContract: ethers.Contract | undefined
  private lastPolledBlock = 0
  private event = new EventTarget()
  public contractAddress: string
  public multisigThreshold = 1 // updates regularly
  public symbol: 'HIVE' | 'HBD'
  public type: ChainType = 'ETH'

  /** Takes either wHIVE or wHBD contract address - Both contracts should be identical */
  constructor(contractAddress: string, symbol: 'HIVE' | 'HBD') {
    if (!process.env.ETH_NODE?.replaceAll('"', '')) {
      throw new Error('Need a valid ETH API node')
    }
    this.symbol = symbol
    this.contractAddress = contractAddress
    this.ethNode = <string>process.env.ETH_NODE?.replaceAll('"', '')
    this.ethNode2 = process.env.ETH_NODE2?.replaceAll('"', '')
    const network = new ethers.Network('Sepolia', 11155111)
    this.provider = new ethers.JsonRpcProvider(this.ethNode, network, {
      staticNetwork: network,
    })
    this.contract = new ethers.Contract(
      this.contractAddress,
      ethContractABI,
      this.provider
    )
    if (this.ethNode2) {
      this.backupProvider = new ethers.JsonRpcProvider(this.ethNode2, network, {
        staticNetwork: network,
      })
      this.backupContract = new ethers.Contract(
        this.contractAddress,
        ethContractABI,
        this.backupProvider
      )
    }
  }

  public start() {
    setInterval(async () => {
      try {
        await this.getUnwrapEvents(this.provider)
        this.updateMultisigThreshold()
      } catch {
        if (this.backupProvider) {
          this.getUnwrapEvents(this.backupProvider).catch(() => {})
        }
      }
    }, this.POLLING_INTERVAL)
  }

  /** Triggers on unwrap events */
  public onUnwrap(cb: (detail: UnwrapEvent) => void) {
    this.event.addEventListener('unwrap', (e) => {
      const pe = e as CustomEvent
      cb(pe.detail)
    })
  }

  /** Every pair (trx_id, op_in_trx) can mint once */
  public async hasMinted(
    trxId: string,
    opInTrx: number,
    contract = this.contract
  ): Promise<boolean> {
    try {
      const result = await withTimeout(contract.hasMinted(trxId, opInTrx), 5000)
      return result
    } catch (e) {
      // on error call the backup node if exists
      if (this.backupContract && contract !== this.backupContract) {
        return this.hasMinted(trxId, opInTrx, this.backupContract)
      }
      console.log('Error in hasMinted:')
      throw e
    }
  }

  /** Hash wrap;address;amount;trx_id;op_in_trx;contract */
  public hashWrapMsg(
    address: string,
    amount: number,
    trxId: string,
    opInTrx: number
  ) {
    return ethers.keccak256(
      ethers.solidityPacked(
        [
          'string',
          'string',
          'address',
          'string',
          'uint256',
          'string',
          'string',
          'string',
          'uint32',
          'string',
          'address',
        ],
        [
          'wrap',
          ';',
          address,
          ';',
          amount,
          ';',
          trxId,
          ';',
          opInTrx,
          ';',
          this.contractAddress,
        ]
      )
    )
  }

  public async signMsgHash(msgHash: string) {
    const ACTIVE_KEY = <string>process.env.ACTIVE_KEY?.replaceAll('"', '')
    if (!ACTIVE_KEY) {
      throw new Error('No ACTIVE_KEY found in .env but signMsgHash was called.')
    }
    const signingKey = new ethers.SigningKey(PrivateKey.from(ACTIVE_KEY).key)
    return signingKey.sign(msgHash).serialized
  }

  private updateMultisigThreshold = async () => {
    try {
      const newValue = Number(await this.contract.multisigThreshold())
      if (!isNaN(newValue) && newValue !== this.multisigThreshold) {
        this.multisigThreshold = newValue
        logger.info(`ERC20 ${this.symbol} multiSigThreshold=${newValue}`)
      }
    } catch {
      // It's ok
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
      const result = await withTimeout(
        this.contract.queryFilter(filter, this.lastPolledBlock + 1, safeBlock),
        6000
      )
      result.forEach(async (res) => {
        const eventLog = <ethers.EventLog>res
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
}

configDotenv()

const HIVE_ETH_CONTRACT = process.env.HIVE_ETH_CONTRACT?.replaceAll('"', '')
const HBD_ETH_CONTRACT = process.env.HBD_ETH_CONTRACT?.replaceAll('"', '')

if (!HIVE_ETH_CONTRACT) {
  throw new Error('Missing contract address for wHIVE')
}
if (!HBD_ETH_CONTRACT) {
  throw new Error('Missing contract address for wHBD')
}

export const erc20HIVE = new ETHService(
  HIVE_ETH_CONTRACT,
  'HIVE'
) satisfies ChainServiceInstance
export const erc20HBD = new ETHService(
  HBD_ETH_CONTRACT,
  'HBD'
) satisfies ChainServiceInstance
