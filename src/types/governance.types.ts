import { ChainService } from './chain.types'

export type ChainSymbolKey =
  | `${ChainService['name']}${ChainService['symbol']}`
  | 'HIVE'

export type ProposalKey = `${ChainSymbolKey}:${Method}:${string}:${number}`

export type Method =
  | 'add-signer'
  | 'remove-signer'
  | 'update-threshold'
  | 'pause'
  | 'unpause'
