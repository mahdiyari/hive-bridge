import { logger } from '../utils/logger'
import { config } from '@/config'
import { getAccount, getPublicActiveKeys } from '@/utils/hive.utils'

const TREASURY = config.hive.treasury
const operatorTimeout = config.network.operators.timeout
export let hiveMultisigThreshold = 1

class Operator {
  username: string
  lastSeen: number = 0
  // The operator must have one active key on their account
  publicKey: string
  private dateAdded = Date.now()

  constructor(username: string, publicKey: string) {
    this.username = username
    this.publicKey = publicKey
  }
  updateLastSeen() {
    this.lastSeen = Date.now()
  }
  status() {
    if (this.lastSeen === 0 && Date.now() - this.dateAdded > operatorTimeout) {
      return 'NOT_CONNECTED'
    } else if (this.lastSeen === 0) {
      return 'WAITING'
    } else if (Date.now() - this.lastSeen > operatorTimeout) {
      return 'NOT_CONNECTED'
    }
    return 'CONNECTED'
  }
}

export const operators: Map<string, Operator> = new Map()

/**
 * Update the operators list from the treasury account's active authority
 * Fetches the current operators and their public keys from the Hive blockchain
 */
const updateOperators = async () => {
  try {
    const res = await getAccount(TREASURY)
    if (!res?.active) {
      logger.error('Failed to fetch treasury account data')
      return
    }

    const active = res.active.account_auths
    const newThreshold = Number(res.active.weight_threshold)
    const newOps: string[] = []
    const currentOps = operators.keys().toArray()

    for (let i = 0; i < active.length; i++) {
      const username = active[i][0]
      const pubKeys = await getPublicActiveKeys(username)
      if (!pubKeys || pubKeys.length === 0) {
        logger.warning(`No public keys found for operator: ${username}`)
        continue
      }
      if (!operators.get(username)) {
        const op = new Operator(username, pubKeys[0])
        operators.set(username, op)
      }
      newOps.push(username)
    }

    const deletedOperators = currentOps.filter((item) => !newOps.includes(item))
    const addedOperators = newOps.filter((item) => !currentOps.includes(item))

    if (addedOperators.length > 0) {
      logger.info(`operators added to the treasury account: ${addedOperators}`)
    }
    if (deletedOperators.length > 0) {
      logger.info(
        `operators removed from the treasury account: ${deletedOperators}`
      )
      deletedOperators.forEach((val) => {
        operators.delete(val)
      })
    }
    if (newThreshold !== hiveMultisigThreshold) {
      logger.info(`hiveMultisigThreshold=${newThreshold}`)
      hiveMultisigThreshold = newThreshold
    }
  } catch (error) {
    logger.error('Error updating operators:', error)
  }
}

// Update operators list periodically
updateOperators()
setInterval(() => {
  updateOperators()
}, config.network.operators.updateInterval)
