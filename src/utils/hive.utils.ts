import { callRPC, Transaction } from 'hive-tx'
import { hexToBytes } from '@noble/hashes/utils.js'
import { config } from '@/config'

/**
 * Build a deterministic Hive transaction based on timestamp
 * @param from - Sender account username
 * @param to - Recipient account username
 * @param amount - Amount with asset symbol (e.g., "10.000 HIVE")
 * @param memo - Transaction memo
 * @param timestamp - Unix timestamp in milliseconds
 * @returns Transaction object ready to be signed and broadcast
 */
export const buildHiveTransfer = async (
  from: string,
  to: string,
  amount: string,
  memo: string,
  timestamp: number
) => {
  const ops = [
    [
      'transfer',
      {
        from,
        to,
        amount,
        memo,
      },
    ],
  ]
  const trx = await createTransaction(
    ops,
    config.hive.transaction.expirationMs,
    timestamp
  )
  return new Transaction({ transaction: trx })
}

/**
 * All times are in ms
 */
const createTransaction = async (
  operations: any[],
  exp: number,
  timestamp: number
) => {
  const blockNum = await getBlockNumFromTimestamp(timestamp)
  const block = await callRPC('condenser_api.get_block', [blockNum])
  const blockId = block.block_id
  const refBlockNum = blockNum & 0xffff
  const uintArray = hexToBytes(blockId)
  const refBlockPrefix =
    uintArray[4] |
    (uintArray[5] << 8) |
    (uintArray[6] << 16) |
    (uintArray[7] << 24)
  const expiration = new Date(timestamp + exp).toISOString().slice(0, -5)
  return {
    expiration,
    extensions: [],
    operations,
    ref_block_num: refBlockNum,
    ref_block_prefix: refBlockPrefix,
    signatures: [],
  }
}

const cache: Map<number, number> = new Map()
setInterval(() => {
  cache.clear()
}, 120_000)

/**
 * Find/estimate the highest block_num where its timestamp <= targetTimestamp
 * @param timestamp - targetTimestamp - Unix timestamp in milliseconds
 * @returns Estimated block number
 */
const getBlockNumFromTimestamp = async (timestamp: number) => {
  // Round the timestamp to the start of minute for determinism
  const targetTimestamp = startOfMinute(timestamp)
  let cached = cache.get(targetTimestamp)
  if (cached) {
    return cached
  }

  // Use last_irreversible_block as reference
  const headBlock = await getLIB()
  let estimatedBlockNum = headBlock
  let foundTimestamp = await getBlockTimestamp(estimatedBlockNum)

  let countFirstEstimation = 0
  // First find a block in a 15 seconds range OR estimate 5 times max
  while (
    countFirstEstimation < 5 &&
    Math.abs(foundTimestamp - targetTimestamp) >= 15_000
  ) {
    // Estimate block_num based on headblock
    const delta = foundTimestamp - targetTimestamp
    estimatedBlockNum = estimatedBlockNum - Math.round(delta / 3000)
    // Don't overshoot
    if (estimatedBlockNum > headBlock) {
      estimatedBlockNum = headBlock
    }
    foundTimestamp = await getBlockTimestamp(estimatedBlockNum)
    countFirstEstimation++
  }
  let i = 0
  // At this point we should be close so walk one by one
  // First make sure estimation is lower than the target
  while (foundTimestamp > targetTimestamp) {
    // Safety throw
    if (i > 50) {
      throw new Error(
        `Error in estimating block number from timestamp1. Got:${foundTimestamp}, Target:${targetTimestamp}`
      )
    }
    i++
    estimatedBlockNum--
    foundTimestamp = await getBlockTimestamp(estimatedBlockNum)
  }

  let lastCloseEstimate = 0
  // Now walk forward until we go above the target
  // Find the highest block_num which has timestamp <= targetTimestamp
  while (foundTimestamp <= targetTimestamp) {
    // Safety throw
    if (i > 70) {
      throw new Error(
        `Error in estimating block number from timestamp2. Got:${foundTimestamp}, Target:${targetTimestamp}`
      )
    }
    i++
    lastCloseEstimate = estimatedBlockNum
    estimatedBlockNum++
    if (estimatedBlockNum > headBlock) {
      // Make sure we don't overshoot
      estimatedBlockNum = headBlock
      break
    }
    foundTimestamp = await getBlockTimestamp(estimatedBlockNum)
  }

  cache.set(targetTimestamp, lastCloseEstimate)
  return lastCloseEstimate
}

const startOfMinute = (timestamp: number) => {
  const date = new Date(timestamp)
  date.setSeconds(0, 0)
  return date.getTime()
}

const getBlockTimestamp = async (blockNum: number) => {
  const res = await callRPC('condenser_api.get_block_header', [blockNum])
  if (res?.timestamp) {
    return new Date(res.timestamp + '.000Z').getTime()
  } else {
    return 0
  }
}

const getLIB = async () => {
  const res = await callRPC('condenser_api.get_dynamic_global_properties')
  return res.last_irreversible_block_num as number
}

export const getAccount = async (username: string) => {
  const result = await callRPC('condenser_api.get_accounts', [[username]])
  return result[0] as {
    active: {
      account_auths: [string, number][]
      key_auths: [string, number][]
      weight_threshold: number
    }
    memo_key: string
  }
}

export const getPublicActiveKeys = async (username: string) => {
  const res = await getAccount(username)
  const active = res.active.key_auths
  const pubKeys: string[] = []
  for (let i = 0; i < active.length; i++) {
    pubKeys.push(active[i][0])
  }
  return pubKeys
}
