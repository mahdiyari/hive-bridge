import { call, Signature, Transaction } from 'hive-tx'
import { operators } from './Operators'

class PendingUnwraps {
  private multisigTreshold = 2 // We should get this from the API
  private unwraps: Map<string, Transaction> = new Map()

  constructor() {
    setInterval(() => {
      this.unwraps.forEach(async (trx, ethTrxHash) => {
        if (trx.signedTransaction) {
          const signatures = trx.signedTransaction.signatures
          if (signatures.length >= this.multisigTreshold) {
            try {
              const res = await trx.broadcast()
              console.log(res)
            } catch (e) {
              console.log(e)
              // Should fail due to duplicate transaction error if broadcasted by other peers
            }
            this.unwraps.delete(ethTrxHash)
          }
        }
      })
    }, 5_000)

    // Check and remove already unwrapped trxs
    setInterval(async () => {
      for (const [k, trx] of this.unwraps) {
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

  public async addUnwrap(ethTrxHash: string, trx: Transaction) {
    // Skip already broadcasted transactions
    const res = await call('condenser_api.get_transaction', [trx.digest().txId])
    if (!res?.result) {
      this.unwraps.set(ethTrxHash, trx)
    }
  }

  public getUnwrap(ethTrxHash: string) {
    return this.unwraps.get(ethTrxHash)
  }

  /** Verify the signature and add to the trx */
  public async addSignature(
    operator: string,
    ethTrxHash: string,
    signature: string,
    retry = 1
  ) {
    try {
      const trx = this.unwraps.get(ethTrxHash)
      if (trx) {
        const sig = Signature.from(signature)
        const recoveredKey = sig.getPublicKey(trx.digest().digest).toString()
        const operatorKey = operators.getOperatorKeys(operator)
        if (!operatorKey) {
          return
        }
        for (let i = 0; i < operatorKey.length; i++) {
          if (recoveredKey === operatorKey[i]) {
            trx.addSignature(signature)
            break
          }
        }
      } else {
        if (retry) {
          // We might have not synced the transaction yet, wait and try one more time
          setTimeout(() => {
            this.addSignature(operator, ethTrxHash, signature, 0)
          }, 30_000)
        }
      }
    } catch {
      // Ignore badly formatted signatures
    }
  }

  public getAllUnwraps() {
    return this.unwraps
  }
}

export const pendingUnwraps = new PendingUnwraps()
