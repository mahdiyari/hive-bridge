import { bytesToHex } from '@noble/hashes/utils'
import { configDotenv } from 'dotenv'
import { ethers } from 'ethers'
import { call, PublicKey } from 'hive-tx'

configDotenv()

const TREASURY = process.env.TREASURY
if (!TREASURY) {
  throw new Error('Missing treasury account name')
}

class Operators {
  private MISSING_TIMEOUT = 100_000
  /** Operators list updated every 10m - username[] */
  private operators: string[] = []
  /** Operators public keys updated every 10m - <username, keys[]> */
  private operatorKeys: Map<string, Array<string>> = new Map()
  /** Operators eth addresses updated every 10m - <username, addresses[]> */
  private operatorAddresses: Map<string, Array<string>> = new Map()
  // private operatorsStatus: Map<string, 'OK' | 'MISSING'> = new Map()
  /** <username, timestamp> */
  private operatorsLastSeen: Map<string, number> = new Map()

  constructor() {
    this.updateOperators()
    setInterval(() => {
      this.updateOperators()
    }, 600_000)
  }

  public getOperators() {
    return this.operators
  }

  public getOperatorKeys(operator: string) {
    return this.operatorKeys.get(operator)
  }

  public getOperatorAddresses(operator: string) {
    return this.operatorAddresses.get(operator)
  }

  public getOperatorsStatus() {
    const temp: Record<string, 'MISSING' | 'OK'> = {}
    this.operators.forEach((value) => {
      const lastSeen = Number(this.operatorsLastSeen.get(value)) || 0
      const status =
        Date.now() - lastSeen > this.MISSING_TIMEOUT ? 'MISSING' : 'OK'
      temp[value] = status
    })
    return temp
  }

  public setOperatorLastSeen(operator: string, lastSeen: number) {
    this.operatorsLastSeen.set(operator, lastSeen)
  }

  private updateOperators = async () => {
    const res = await call('condenser_api.get_accounts', [[TREASURY]])
    const active = res.result[0].active.account_auths
    const temp = []
    for (let i = 0; i < active.length; i++) {
      const username = active[i][0]
      const pubKey = await this.getOperatorPublicActiveKeys(username)
      temp.push(username)
      const addresses = []
      for (let k = 0; k < pubKey.length; k++) {
        const pkey = PublicKey.from(pubKey[k])
        const hexPubKey = '0x' + bytesToHex(pkey.key)
        addresses.push(ethers.computeAddress(hexPubKey))
      }
      this.operatorKeys.set(username, pubKey)
      this.operatorAddresses.set(username, addresses)
    }
    this.operators = temp
  }

  private getOperatorPublicActiveKeys = async (operator: string) => {
    const res = await call('condenser_api.get_accounts', [[operator]])
    const active = res.result[0].active.key_auths
    const pubKeys: string[] = []
    for (let i = 0; i < active.length; i++) {
      pubKeys.push(active[i][0])
    }
    return pubKeys
  }
}

export const operators = new Operators()
