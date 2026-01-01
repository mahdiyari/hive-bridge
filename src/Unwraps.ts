import { callRPC, PrivateKey, Signature, Transaction } from 'hive-tx'
import { hiveMultisigThreshold, operators } from '@/network/Operators'
import { logger } from '@/utils/logger'
import { config } from '@/config'
import { messageList } from '@/network/messageList'

const USERNAME = config.hive.operator.username
const ACTIVE_KEY = config.hive.operator.activeKey

class Unwrap {
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

class Unwraps {
  private unwraps: Map<string, Unwrap> = new Map()

  constructor() {
    setInterval(() => {
      this.unwraps.forEach(async (unwrap, trxHash) => {
        if (unwrap.hasEnoughSignatures(hiveMultisigThreshold)) {
          try {
            await unwrap.trx.broadcast()
            this.unwraps.delete(trxHash)
            logger.debug(
              'Successful unwrap:',
              unwrap.trx.transaction?.operations[0]
            )
          } catch (e) {
            // hive-tx will catch and ignore the duplicate transaction error
            // we might enconter other errors here so log them for now
            logger.warning('Not a big deal I guess:', e)
          }
        } else {
          // Not enough signatures so request more
          messageList.REQUEST_HIVE_SIGNATURES(trxHash)
        }
      })
    }, 10_000)

    // Check and remove already unwrapped trxs
    setInterval(async () => {
      for (const [k, { trx }] of this.unwraps) {
        try {
          const res = await callRPC('condenser_api.get_transaction', [
            trx.digest().txId,
          ])
          if (res) {
            this.unwraps.delete(k)
          }
        } catch {}
      }
    }, 20_000)
  }

  public async addUnwrap(trxHash: string, trx: Transaction) {
    // Skip already broadcasted transactions
    try {
      await callRPC('condenser_api.get_transaction', [trx.digest().txId])
      // should throw if not exists
    } catch (e) {
      console.log(e instanceof Error)
      if (e instanceof Error && e.message.includes('Unknown Transaction')) {
        const unwrap = new Unwrap(trx)
        this.unwraps.set(trxHash, unwrap)
        // If we are operator, sign and broadcast our signature
        if (ACTIVE_KEY && USERNAME) {
          const privateKey = PrivateKey.from(ACTIVE_KEY)
          const sig = privateKey.sign(trx.digest().digest)
          pendingUnwraps.addSignature(USERNAME, trxHash, sig.customToString())
          messageList.HIVE_SIGNATURES({
            trxHash,
            operators: [USERNAME],
            signatures: [sig.customToString()],
          })
        }
      }
    }
  }

  public getUnwrap(trxHash: string) {
    return this.unwraps.get(trxHash)
  }

  /**
   * Verify the signature and add to the Hive transaction
   * @param operator Username of the signer
   * @param trxHash Transaction hash of the burn/unwrap
   * @param signature Hive signature
   * @param retry Optional: automatically increments for each retry
   */
  public async addSignature(
    operator: string,
    trxHash: string,
    signature: string,
    retry = 0
  ) {
    try {
      const unwrap = this.unwraps.get(trxHash)
      if (unwrap) {
        if (unwrap.hasOperator(operator)) {
          return
        }
        const { trx } = unwrap
        const sig = Signature.from(signature)
        const recoveredKey = sig.getPublicKey(trx.digest().digest).toString()
        const operatorKey = operators.get(operator)?.publicKey
        if (!operatorKey) {
          return
        }
        if (recoveredKey === operatorKey) {
          trx.addSignature(signature)
          unwrap.addOperator(operator)
        }
      } else {
        if (retry < 10) {
          retry++
          // We might have not synced the transaction yet, wait and try again
          setTimeout(() => {
            this.addSignature(operator, trxHash, signature, retry)
          }, 5_000)
        }
      }
    } catch (e) {
      // Ignore badly formatted signatures
      logger.debug('Got a badly formatted signature?', e)
    }
  }

  public getAllUnwraps() {
    return this.unwraps
  }
}

export const pendingUnwraps = new Unwraps()
