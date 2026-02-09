export type TransferHistory = [
  number,
  {
    op: [
      'transfer',
      {
        to: string
        from: string
        memo: string
        amount: string
      }
    ]
    block: number
    trx_id: string
    op_in_trx: number
    timestamp: string
    virtual_op: false
    trx_in_block: number
  }
]

export interface TransferBody {
  from: string
  to: string
  memo: string
  amount: string
  blockNum: number
  timestamp: number
  trxId: string
  opInTrx: number
}
