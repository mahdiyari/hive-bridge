import { ChainService } from './chain.types'

type ChainSymbolKey =
  | `${ChainService['name']}${ChainService['symbol']}`
  | 'hive'

export type Signatures = {
  [K in ChainSymbolKey]: string
}
export type SignaturesMap = Map<string, Signatures>

export type ProposalKey = `${Method}:${string}`

export type Method =
  | 'add-signer'
  | 'remove-signer'
  | 'update-threshold'
  | 'pause'
  | 'unpause'
