import { call } from 'hive-tx'

const cache: Map<number, number> = new Map()

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
 */
export const getBlockNumFromTimestamp = async (timestamp: number) => {
	// Round the timestamp to the start of hour
	const targetTimestamp = startOfHour(timestamp)
	if (cache.has(targetTimestamp)) {
		return <number> cache.get(targetTimestamp)
	}
	let delta = knownTimestamp - targetTimestamp
	let estimatedBlockNum = knownBlock - Math.round(delta / 3000)
	let foundTimestamp = await getBlockTimestamp(estimatedBlockNum)
	while (foundTimestamp - targetTimestamp >= errorMargin) {
		delta = foundTimestamp - targetTimestamp
		estimatedBlockNum -= Math.round(delta / 3000)
		foundTimestamp = await getBlockTimestamp(estimatedBlockNum)
		while (foundTimestamp === 0) {
			// in case we overshoot
			estimatedBlockNum -= 1000
			foundTimestamp = await getBlockTimestamp(estimatedBlockNum)
		}
	}
	cache.set(targetTimestamp, estimatedBlockNum)
	return estimatedBlockNum
}

const startOfHour = (timestamp: number) => {
	const date = new Date(timestamp)
	date.setMinutes(0, 0, 0)
	return date.getTime()
}

const getBlockTimestamp = async (blockNum: number) => {
	const res = await call('condenser_api.get_block_header', [blockNum])
	if (res?.result?.timestamp) {
		return new Date(res.result.timestamp).getTime()
	} else {
		return 0
	}
}
