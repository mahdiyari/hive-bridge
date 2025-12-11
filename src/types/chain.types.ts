/**
 * All blockchain services (except HiveService) must satisfy this interface
 */
export interface ChainService {
  start(): void
  onUnwrap(cb: unwrapCallback): void
  hasMinted(trxId: string, opInTrx: number): Promise<boolean>
  /** @argument amount Amount without decimals i.e. "1.123 HIVE" => 1123 */
  hashWrapMsg(
    address: string,
    amount: number,
    trxId: string,
    opInTrx: number
  ): string
  signMsgHash(msgHash: string): Promise<string>
  isAddress(address: string): boolean
  toAddress(publicKey: string): string
  hashUpdateMultisigThresholdMsg(newThreshold: number): Promise<string>
  hashAddSignerMsg(username: string, address: string): Promise<string>
  hashRemoveSignerMsg(username: string): Promise<string>
  hashPauseMsg(): Promise<string>
  hashUnPauseMsg(): Promise<string>
  recoverAddress(msgHash: string, signature: string): string
  contractAddress: string
  multisigThreshold: number
  name: ChainName
  symbol: 'HIVE' | 'HBD'
}

type unwrapCallback = (detail: UnwrapEvent) => void

export interface UnwrapEvent {
  blockNum: number
  blockTime: number
  trx: string
  messenger: string
  amount: bigint
  username: string
}

// Short name of the chains used in memo
export type ChainName = 'ETH'
