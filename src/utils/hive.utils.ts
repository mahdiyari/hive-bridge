import { call, Transaction } from 'hive-tx'
import { hexToBytes } from '@noble/hashes/utils.js'

/** Build a deterministic Hive transaction based on timestamp */
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
  // 1 hour expiration (max currently) - increase it after the hardfork
  const trx = await createTransaction(ops, 3_600_000, timestamp)
  return new Transaction(trx)
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
  const block = await call('condenser_api.get_block', [blockNum])
  const blockId = block.result.block_id
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
  }
}

const cache: Map<number, number> = new Map()

/* WARNING */
// Changing these values might result in double unwrapping
// Because the hive transaction parameters might change
// Don't chnage the following 3 unless understood how it works
const knownTimestamp = new Date('2025-04-09T14:19:36.000Z').getTime()
const knownBlock = 94878350
const errorMargin = 15 * 60 * 1000

/** Find/estimate a block produced at near certain timestamp
 * We try to be deterministic with a margin of error of 15 minutes
 * Error under 1 hour would be acceptable because max transaction expiration is 1 hours
 * We need deterministic results for generating deterministic transactions across the network
 * to prevent double unwrapping
 */
const getBlockNumFromTimestamp = async (timestamp: number) => {
  // Round the timestamp to the start of minute
  const targetTimestamp = startOfMinute(timestamp)
  if (cache.has(targetTimestamp)) {
    return <number>cache.get(targetTimestamp)
  }
  let delta = knownTimestamp - targetTimestamp // -number
  let estimatedBlockNum = knownBlock - Math.round(delta / 3000)
  let foundTimestamp = await getBlockTimestamp(estimatedBlockNum)
  while (Math.abs(foundTimestamp - targetTimestamp) >= errorMargin) {
    while (foundTimestamp === 0) {
      // in case we overshoot
      estimatedBlockNum -= 1000
      foundTimestamp = await getBlockTimestamp(estimatedBlockNum)
    }
    delta = foundTimestamp - targetTimestamp // -number
    estimatedBlockNum -= Math.round(delta / 3000)
    foundTimestamp = await getBlockTimestamp(estimatedBlockNum)
  }
  cache.set(targetTimestamp, estimatedBlockNum)
  return estimatedBlockNum
}

const startOfMinute = (timestamp: number) => {
  const date = new Date(timestamp)
  date.setSeconds(0, 0)
  return date.getTime()
}

const getBlockTimestamp = async (blockNum: number) => {
  const res = await call('condenser_api.get_block_header', [blockNum])
  if (res?.result?.timestamp) {
    return new Date(res.result.timestamp + '.000Z').getTime()
  } else {
    return 0
  }
}

export const getAccount = async (username: string) => {
  try {
    const result = await call('condenser_api.get_accounts', [[username]])
    if (result?.result && result.result[0]) {
      return result.result[0] as {
        active: {
          account_auths: [string, number][]
          key_auths: [string, number][]
          weight_threshold: number
        }
        memo_key: string
      }
    }
    return null
  } catch {
    return null
  }
}

export const getPublicActiveKeys = async (username: string) => {
  const res = await call('condenser_api.get_accounts', [[username]])
  const active = res.result[0].active.key_auths
  const pubKeys: string[] = []
  for (let i = 0; i < active.length; i++) {
    pubKeys.push(active[i][0])
  }
  return pubKeys
}
