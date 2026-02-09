import { Transaction } from 'hive-tx'

export class Unwrap {
  public trx: Transaction
  public operators: string[]
  public timestamp: number

  constructor(trx: Transaction) {
    this.trx = trx
    this.operators = []
    this.timestamp = Date.now()
  }

  public addOperator(operator: string) {
    if (!this.hasOperator(operator)) {
      this.operators.push(operator)
    }
  }

  public hasOperator(operator: string): boolean {
    return this.operators.includes(operator)
  }

  public hasEnoughSignatures(threshold: number): boolean {
    return this.operators.length >= threshold
  }
}
