import { bytesToHex } from '@noble/hashes/utils.js'
import { ethers } from 'ethers'
import { call, PublicKey } from 'hive-tx'
import { logger } from '../utils/logger'
import { config } from '@/config'

const TREASURY = config.hive.treasury
const operatorTimeout = 30_000
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

const updateOperators = async () => {
  const res = await call('condenser_api.get_accounts', [[TREASURY]])
  const active = res.result[0].active.account_auths
  const newThreshold = Number(res.result[0].active.weight_threshold)
  const newOps: string[] = []
  const currentOps = operators.keys().toArray()
  for (let i = 0; i < active.length; i++) {
    const username = active[i][0]
    const pubKeys = await getPublicActiveKeys(username)
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
}

const getPublicActiveKeys = async (username: string) => {
  const res = await call('condenser_api.get_accounts', [[username]])
  const active = res.result[0].active.key_auths
  const pubKeys: string[] = []
  for (let i = 0; i < active.length; i++) {
    pubKeys.push(active[i][0])
  }
  return pubKeys
}

// Update operators list every 5min
updateOperators()
setInterval(() => {
  updateOperators()
}, 300_000)
