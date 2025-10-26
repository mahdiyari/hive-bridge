import { ChainType } from '../components/p2p/helpers/types'

export interface ChainServiceInstance {
  start(): void
  onUnwrap(cb: callback): void
  hasMinted(
    trxId: string,
    opInTrx: number,
    contractInstance?: any
  ): Promise<boolean>
  /** @argument amount Amount without decimals i.e. "1.123 HIVE" => 1123 */
  hashWrapMsg(
    address: string,
    amount: number,
    trxId: string,
    opInTrx: number
  ): string
  signMsgHash(msgHash: string): Promise<string>
  contractAddress: string
  multisigThreshold: number
  type: ChainType
  symbol: 'HIVE' | 'HBD'
}

type callback = (detail: UnwrapEvent) => void

export interface UnwrapEvent {
  blockNum: number
  blockTime: number
  trx: string
  messenger: string
  amount: bigint
  username: string
}
