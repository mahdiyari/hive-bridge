import { pendingUnwraps } from '@/Unwraps'
import { pendingWraps } from '@/Wraps'
import { ethers } from 'ethers'
import { Express, json, Request, Response } from 'express'
import { peers } from './Peers'
import { hiveMultisigThreshold, operators } from './Operators'
import { addedChainServices } from '@/blockchain'
import { version } from '../../package.json'
import { proposals } from '@/governance/Governance'

interface OperatorStatus {
  username: string
  status: 'CONNECTED' | 'NOT_CONNECTED' | 'WAITING'
}

interface WrapResponse {
  msgHash: string
  data: {
    chainName: string
    symbol: 'HIVE' | 'HBD'
    address: string
    amount: number
    trxId: string
    opInTrx: number
    contract: string
    username: string
  }
  operators: string[]
  signatures: string[]
  timestamp: number
}

/**
 * Setup REST API endpoints for bridge status and pending operations
 */
export const API = (app: Express) => {
  app.use(json())
  // Allow CORS for simple GET endpoints
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    next()
  })

  app.get('/', (_req, res) => {
    const chains = Object.keys(addedChainServices)
    let opsConnected = 0
    const ops: OperatorStatus[] = []
    operators.forEach((op) => {
      const status = op.status()
      if (status === 'CONNECTED') {
        opsConnected++
      }
      ops.push({ username: op.username, status })
    })

    const pendingWrapsCount = pendingWraps.getAllPendingWraps().size
    const pendingUnwrapsCount = pendingUnwraps.getAllUnwraps().size
    const connectedPeers = peers.getAllPeers().length

    res.json({
      version,
      chains,
      multisig_threshold: hiveMultisigThreshold,
      operators: ops,
      bridge_health:
        opsConnected >= hiveMultisigThreshold ? 'HEALTHY' : 'UNKNOWN',
      stats: {
        pending_wraps: pendingWrapsCount,
        pending_unwraps: pendingUnwrapsCount,
        connected_peers: connectedPeers,
        connected_operators: opsConnected,
        total_operators: operators.size,
      },
    })
  })

  app.get('/status', (_req, res) => {
    res.json({ status: 'OK' })
  })

  app.get('/pending-hive-wraps', (_req, res) => {
    const allWraps = pendingWraps.getAllPendingWraps()
    const wraps: WrapResponse[] = []
    allWraps.forEach((wrap) => {
      wraps.push({
        msgHash: wrap.msgHash,
        data: wrap.data,
        operators: wrap.operators,
        signatures: wrap.signatures,
        timestamp: wrap.timestamp,
      })
    })
    res.json(wraps)
  })

  app.get('/pending-hive-wraps/:usernameOrAddress', (req, res) => {
    const userOrAddress = req.params.usernameOrAddress
    // Input validation
    if (!userOrAddress || userOrAddress.length < 3) {
      return res.status(400).json({ error: 'Invalid parameter' })
    }
    // Sanitize input - allow only alphanumeric and basic Ethereum address chars
    if (!/^[a-zA-Z0-9.-]+$/.test(userOrAddress)) {
      return res.status(400).json({ error: 'Invalid characters in parameter' })
    }
    // Probably an Ethereum address (0x prefix or longer than max Hive username)
    if (userOrAddress.length > 16) {
      // Validate Ethereum address format
      if (!ethers.isAddress(userOrAddress)) {
        return res.status(400).json({ error: 'Invalid Ethereum address' })
      }
      const wraps = pendingWraps.getWrapsByAddress(userOrAddress)
      return res.json(wraps)
    }
    // Hive username
    const wraps = pendingWraps.getWrapsByUsername(userOrAddress)
    res.json(wraps)
  })

  app.get('/pending-hive-unwraps', (_req, res) => {
    res.json(Object.fromEntries(pendingUnwraps.getAllUnwraps()))
  })

  app.get('/peers', (_req, res) => {
    const peersArray = peers.getAllPeers()
    const temp: { id: string; address: string }[] = []
    peersArray.forEach((value) => {
      temp.push({ id: value.id, address: value.address || '' })
    })
    res.json(temp)
  })

  app.get('/proposals', (_req, res) => {
    const result = []
    for (const [key, value] of proposals) {
      result.push({
        chain: value.chain,
        method: value.method,
        target: value.target,
        nonce: value.nonce,
        blockNum: value.blockNum,
        createdAt: value.createdAt,
        signatures: Object.fromEntries(value.signatures),
      })
    }
    res.json(result)
  })
}
