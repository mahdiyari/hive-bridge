import { ChainName, ChainService } from '@/types/chain.types'
import { Transaction } from 'hive-tx'

export class Wrap {
  public data: {
    chainName: ChainName
    symbol: 'HIVE' | 'HBD'
    address: string
    amount: number
    trxId: string
    opInTrx: number
    contract: string
    username: string
  }
  public chainInstance: ChainService
  public signatures: string[]
  public operators: string[]
  public timestamp: number
  public msgHash: string

  constructor(
    chainName: ChainName,
    symbol: 'HIVE' | 'HBD',
    chainInstance: ChainService,
    address: string,
    amount: number,
    trxId: string,
    opInTrx: number,
    username: string,
    msgHash: string,
    timestamp: number
  ) {
    this.data = {
      chainName,
      symbol,
      address,
      amount,
      trxId,
      opInTrx,
      contract: chainInstance.contractAddress,
      username,
    }
    this.chainInstance = chainInstance
    this.msgHash = msgHash
    this.timestamp = timestamp
    this.signatures = []
    this.operators = []
  }

  public addSignature(signature: string) {
    if (!this.signatures.includes(signature)) {
      this.signatures.push(signature)
    }
  }

  public addOperator(operator: string) {
    if (!this.hasOperator(operator)) {
      this.operators.push(operator)
    }
  }

  public hasOperator(operator: string): boolean {
    return this.operators.includes(operator)
  }
}
