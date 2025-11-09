import { pendingUnwraps } from '@/Unwraps'
import { pendingWraps } from '@/Wraps'
import { ethers } from 'ethers'
import { Express, json } from 'express'
import { peers } from './Peers'
import { hiveMultisigThreshold, operators } from './Operators'
import { addedChainServices } from '@/blockchain'
import { version } from '../../package.json'

export const API = (app: Express) => {
  app.use(json())
  // Allow CORS for simple GET endpoints
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    next()
  })

  app.get('/', (req, res) => {
    const chains: string[] = []
    addedChainServices.forEach((val) => {
      chains.push(`${val.name}:${val.symbol}`)
    })
    let opsConnected = 0
    const ops: {}[] = []
    operators.forEach((op) => {
      if (op.status() === 'CONNECTED') {
        opsConnected++
      }
      ops.push({ usrename: op.username, status: op.status() })
    })

    res.json({
      version,
      chains,
      multisig_threshold: hiveMultisigThreshold,
      operators: ops,
      bridge_health:
        opsConnected >= hiveMultisigThreshold ? 'HEALTHY' : 'UNKNOWN',
    })
  })

  app.get('/status', (req, res) => {
    res.json({ status: 'OK' })
  })

  app.get('/pending-hive-wraps', (req, res) => {
    const allWraps = pendingWraps.getAllPendingWraps()
    const temp: {}[] = []
    allWraps.forEach((wrap, hash) => {
      temp.push({
        msgHash: wrap.msgHash,
        data: wrap.data,
        operators: wrap.operators,
        signatures: wrap.signatures,
        timestamp: wrap.timestamp,
      })
    })
    res.json(temp)
  })

  app.get('/pending-hive-wraps/:usernameOrAddress', (req, res) => {
    const userOrAddress = req.params.usernameOrAddress
    if (userOrAddress.length < 3) {
      return res.json({ error: 'Bad param' })
    }
    // Probably an address
    if (userOrAddress.length > 16) {
      const wraps = pendingWraps.getWrapsByAddress(userOrAddress)
      return res.json(wraps)
    }
    const wraps = pendingWraps.getWrapsByUsername(userOrAddress)
    res.json(wraps)
  })

  app.get('/pending-hive-unwraps', (req, res) => {
    res.json(Object.fromEntries(pendingUnwraps.getAllUnwraps()))
  })

  app.get('/peers', (req, res) => {
    res.json(peers.getAllPeers())
  })

  // app.get('/operators', (req, res) => {
  // res.json(operators.getOperatorsStatus())
  // })
}
