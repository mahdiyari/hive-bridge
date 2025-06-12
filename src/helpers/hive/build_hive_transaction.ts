import { call, Transaction } from 'hive-tx'
import { getBlockNumFromTimestamp } from './get_block_num_from_timestamp.ts'
import { hexToBytes } from '@wevm/viem/utils'

export const buildHiveTransfer = async (
	from: string,
	to: string,
	amount: string,
	memo: string,
	timestamp: number,
) => {
	const ops = [[
		'transfer',
		{
			from,
			to,
			amount,
			memo,
		},
	]]
	// 1 hour expiration (max currently)
	const trx = await createTransaction(ops, 3_600, timestamp)
	return new Transaction(trx)
}

// exp is in seconds
const createTransaction = async (
	operations: any[],
	exp: number,
	timestamp: number,
) => {
	const blockNum = await getBlockNumFromTimestamp(timestamp)
	const expireTime = exp * 1000
	const block = await call('condenser_api.get_block', [blockNum])
	const blockId = block.result.block_id
	const refBlockNum = blockNum & 0xffff
	const uintArray = hexToBytes(blockId)
	const refBlockPrefix = uintArray[4] |
		(uintArray[5] << 8) |
		(uintArray[6] << 16) |
		(uintArray[7] << 24)
	const expiration = new Date(timestamp + expireTime)
		.toISOString()
		.slice(0, -5)
	return {
		expiration,
		extensions: [],
		operations,
		ref_block_num: refBlockNum,
		ref_block_prefix: refBlockPrefix,
	}
}
