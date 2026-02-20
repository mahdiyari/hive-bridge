import { config } from '@/core/config'
import { EthereumService } from './ethereum/EthereumService'
import { ChainName } from '@/types/chain.types'

const contracts = config.eth.testing
  ? config.eth.sepolia.contract
  : config.eth.mainnet.contract
const HIVE_ETH_CONTRACT = contracts.hive
const HBD_ETH_CONTRACT = contracts.hbd

if (!HIVE_ETH_CONTRACT) {
  throw new Error('Missing contract address for wHIVE')
}
if (!HBD_ETH_CONTRACT) {
  throw new Error('Missing contract address for wHBD')
}

const erc20HIVE = new EthereumService(HIVE_ETH_CONTRACT, 'HIVE')
const erc20HBD = new EthereumService(HBD_ETH_CONTRACT, 'HBD')

// Add all chain services here (except HiveService)
export const addedChainServices = {
  ETHHIVE: erc20HIVE,
  ETHHBD: erc20HBD,
}

export const chainNames: ChainName[] = ['ETH']
