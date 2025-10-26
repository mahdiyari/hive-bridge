import { call, PrivateKey, Signature, Transaction } from 'hive-tx'
import { operators } from './Operators'
import { logger } from './logger'
import { p2pNetwork } from './p2p/P2PNetwork'
import { REQUEST_HIVE_SIGNATURES } from './p2p/message/REQUEST_HIVE_SIGNATURES'
import { HIVE_SIGNATURES } from './p2p/message/HIVE_SIGNATURES'

const USERNAME = process.env.USERNAME?.replaceAll('"', '')
const ACTIVE_KEY = process.env.ACTIVE_KEY?.replaceAll('"', '')

class PendingUnwraps {
  private unwraps: Map<string, { operators: string[]; trx: Transaction }> =
    new Map()

  constructor() {
    setInterval(() => {
      this.unwraps.forEach(async ({ trx }, trxHash) => {
        if (trx.signedTransaction) {
          const signatures = trx.signedTransaction.signatures
          if (signatures.length >= operators.hiveMultisigThreshold) {
            try {
              await trx.broadcast()
              this.unwraps.delete(trxHash)
              logger.debug('Successful unwrap:', trx.transaction.operations[0])
            } catch (e) {
              // hive-tx will catch and ignore the duplicate transaction error
              // we might enconter other errors here so log them for now
              logger.warning('Not a big deal I guess:', e)
            }
          } else {
            // Not enough signatures so request more
            REQUEST_HIVE_SIGNATURES(trxHash)
          }
        }
      })
    }, 10_000)

    // Check and remove already unwrapped trxs
    setInterval(async () => {
      for (const [k, { trx }] of this.unwraps) {
        const res = await call('condenser_api.get_transaction', [
          trx.digest().txId,
        ])
        if (!res?.result) {
          continue
        }
        this.unwraps.delete(k)
      }
    }, 20_000)
  }

  public async addUnwrap(trxHash: string, trx: Transaction) {
    try {
      // Skip already broadcasted transactions
      const res = await call('condenser_api.get_transaction', [
        trx.digest().txId,
      ])
      if (!res?.result) {
        this.unwraps.set(trxHash, { trx, operators: [] })
        // If we are operator, sign and broadcast our signature
        if (ACTIVE_KEY && USERNAME) {
          const privateKey = PrivateKey.from(ACTIVE_KEY)
          const sig = privateKey.sign(trx.digest().digest)
          pendingUnwraps.addSignature(USERNAME, trxHash, sig.customToString())
          HIVE_SIGNATURES({
            trxHash,
            operators: [USERNAME],
            signatures: [sig.customToString()],
          })
        }
      }
    } catch (e) {
      // As long as retry works it should be fine
      logger.error('Something went wrong. Retrying:', e)
      this.addUnwrap(trxHash, trx)
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
   * @param retry Optional: automatically incerements for each retry
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
        if (unwrap.operators.includes(operator)) {
          return
        }
        const { trx } = unwrap
        const sig = Signature.from(signature)
        const recoveredKey = sig.getPublicKey(trx.digest().digest).toString()
        const operatorKey = operators.getOperatorKeys(operator)
        if (!operatorKey) {
          return
        }
        for (let i = 0; i < operatorKey.length; i++) {
          if (recoveredKey === operatorKey[i]) {
            trx.addSignature(signature)
            unwrap.operators.push(operator)
            break
          }
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

export const pendingUnwraps = new PendingUnwraps()
