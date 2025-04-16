export type TransferHistory = [number, {
	op: [
		'transfer',
		{
			to: string
			from: string
			memo: string
			amount: string
		},
	]
	block: number
	trx_id: string
	op_in_trx: number
	timestamp: string
	virtual_op: false
	trx_in_block: number
}]

export interface TransferBody {
	from: string
	to: string
	memo: string
	amount: string
	blockNum: number
}

// interface Block {
//   block_id: string
//   extensions: []
//   previous: string
//   signing_key: string
//   timestamp: string
//   transaction_ids: string[]
//   transaction_merkle_root: string
//   transactions: [
//     {
//       block_num: number
//       expiration: string
//       extensions: []
//       operations: [string, any][]
//       ref_block_num: number
//       ref_block_prefix: number
//       signatures: string[]
//       transaction_id: string
//       transaction_num: number
//     },
//   ]
//   witness: string
//   witness_signature: string
// }
