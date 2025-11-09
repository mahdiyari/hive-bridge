import { ethers } from 'ethers'
import { erc20ABI } from './contracts/erc20.abi'
import { ChainService, UnwrapEvent } from '@/types/chain.types'
import { PrivateKey, PublicKey } from 'hive-tx'
import { logger } from '@/utils/logger'
import { ChainName } from '@/types/chain.types'
import { config } from '@/config'
import { bytesToHex } from '@noble/hashes/utils.js'

export class EthereumService implements ChainService {
  // Wait 12 blocks before doing an unwrap
  private CONFIRMATIONS = 12
  // Arbitary number - might adjust later
  private POLLING_INTERVAL = 20_000
  // go back 225 blocks - 45 minutes
  // unwraps should happen fast because of the hive transaction being based on the timestamp
  private historyDepth = 225
  private nodes: string[]
  private provider: ethers.FallbackProvider
  private contract: ethers.Contract
  private event = new EventTarget()
  lastPolledBlock = 0
  contractAddress: string
  multisigThreshold = 1 // updates regularly
  symbol: 'HIVE' | 'HBD'
  name: ChainName = 'ETH'

  /** Takes either wHIVE or wHBD contract address - Both contracts should be identical */
  constructor(contractAddress: string, symbol: 'HIVE' | 'HBD') {
    this.symbol = symbol
    this.contractAddress = contractAddress
    this.nodes = config.eth.nodes
    if (this.nodes.length === 0) {
      throw new Error('Missing Ethereum nodes from config file')
    }
    let quorum = 2
    if (this.nodes.length === 1) {
      logger.warning('More than one Ethereum node is recommended')
      quorum = 1
    }
    const providers = this.nodes.map((node) => new ethers.JsonRpcProvider(node))
    // FallbackProvier calls multiple nodes at the same time and cross-checks by quorum
    this.provider = new ethers.FallbackProvider(providers, undefined, {
      quorum: quorum,
      eventQuorum: quorum,
    })
    this.contract = new ethers.Contract(
      this.contractAddress,
      erc20ABI,
      this.provider
    )
  }

  /** Start after p2p network */
  start() {
    setInterval(async () => {
      await this.getUnwrapEvents()
      this.updateMultisigThreshold()
    }, this.POLLING_INTERVAL)
  }

  /** Triggers on unwrap events */
  onUnwrap(cb: (detail: UnwrapEvent) => void) {
    this.event.addEventListener('unwrap', (e) => {
      const pe = e as CustomEvent
      cb(pe.detail)
    })
  }

  /** Every pair (trx_id, op_in_trx) can mint once */
  async hasMinted(
    trxId: string,
    opInTrx: number,
    contract = this.contract
  ): Promise<boolean> {
    try {
      const result = await contract.hasMinted(trxId, opInTrx)
      if (typeof result !== 'boolean') {
        throw new Error(`Expected boolean but got ${result}`)
      }
      return result
    } catch (e) {
      // I don't think we need to panic here
      logger.warning('Might want to investigate this error:', e)
      // Returning false shouldn't cause any problems
      return false
    }
  }

  /** Hash wrap;address;amount;trx_id;op_in_trx;contract */
  hashWrapMsg(address: string, amount: number, trxId: string, opInTrx: number) {
    // https://github.com/mahdiyari/hive-bridge-eth/blob/0294e02ef8f621ab48e8d7ecf7ac3d88254dd5ed/contracts/WrappedHive.sol#L283
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

  /** Sign a message hash by the active key of operator
   * @returns String serialized signature (65 characters)
   */
  async signMsgHash(msgHash: `0x${string}`) {
    const ACTIVE_KEY = config.hive.operator.activeKey
    if (!ACTIVE_KEY) {
      throw new Error('No ACTIVE_KEY found in .env but signMsgHash was called.')
    }
    const signingKey = new ethers.SigningKey(PrivateKey.from(ACTIVE_KEY).key)
    return signingKey.sign(msgHash).serialized
  }

  /** Return true if the provided string is a valid Ethereum address */
  isAddress = ethers.isAddress

  /** Convert Hive public key to ETH address */
  toAddress(publicKey: string) {
    const pkey = PublicKey.from(publicKey)
    const hexPubKey = '0x' + bytesToHex(pkey.key)
    return ethers.computeAddress(hexPubKey)
  }

  /** Call periodically to get the current multiSigThreshold from the contract */
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

  /** Call periodically to get the Unwrap events from the contract to perform an Unwrap */
  private async getUnwrapEvents() {
    const headBlock = await this.provider.getBlockNumber()
    const safeBlock = headBlock - this.CONFIRMATIONS
    // We don't need the too old data - this should run only the first time
    if (safeBlock - this.lastPolledBlock > this.historyDepth) {
      this.lastPolledBlock = safeBlock - this.historyDepth
    }
    if (safeBlock > this.lastPolledBlock) {
      const filter = this.contract.filters.Unwrap()
      const result = await this.contract.queryFilter(
        filter,
        this.lastPolledBlock + 1,
        safeBlock
      )
      result.forEach(async (res) => {
        const eventLog = <ethers.EventLog>res
        const blockTime = (await eventLog.getBlock()).timestamp
        // Create and dispatch a custom event to be picked up by this.onUnwrap()
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
