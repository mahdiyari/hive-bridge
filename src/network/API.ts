import { pendingUnwraps } from '@/core/Unwraps'
import { pendingWraps } from '@/core/Wraps'
import { ethers } from 'ethers'
import { Express, json } from 'express'
import { peers } from './Peers'
import { hiveMultisigThreshold, operators } from './Operators'
import { addedChainServices } from '@/blockchain'
import { version } from '../../package.json'
import { proposals } from '@/governance/Governance'
import { config } from '@/core/config'

interface OperatorStatus {
  username: string
  status: 'CONNECTED' | 'NOT_CONNECTED' | 'WAITING'
}

const startedAt = Date.now()
const HIVE_USERNAME_RE = /^[a-z0-9.-]+$/
const MAX_QUERY_LIMIT = 500

const parseNumber = (raw: unknown, fallback: number) => {
  const parsed = Number(raw)
  if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
    return fallback
  }
  return parsed
}

const parsePagination = (
  query: Record<string, unknown>
): { limit: number; offset: number; sort: 'asc' | 'desc' } => {
  const limit = Math.min(
    Math.max(parseNumber(query.limit, 100), 1),
    MAX_QUERY_LIMIT
  )
  const offset = Math.max(parseNumber(query.offset, 0), 0)
  const sort = query.sort === 'asc' ? 'asc' : 'desc'
  return { limit, offset, sort }
}

const isHiveUsername = (username: string) => {
  return (
    username.length >= 3 &&
    username.length <= 16 &&
    HIVE_USERNAME_RE.test(username)
  )
}

/**
 * Setup REST API endpoints for bridge status and pending operations
 */
export const API = (app: Express) => {
  app.use(json({ limit: '32kb' }))
  // Allow CORS for simple GET endpoints
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    next()
  })
  app.options('', (_req, res) => {
    res.sendStatus(204)
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

    const chainDetails = Object.entries(addedChainServices).map(
      ([key, chainService]) => ({
        key,
        chain: chainService.name,
        symbol: chainService.symbol,
        contract: chainService.contractAddress,
        multisig_threshold: chainService.multisigThreshold,
      })
    )

    res.json({
      version,
      server_time: Date.now(),
      uptime_ms: Date.now() - startedAt,
      chains,
      chain_details: chainDetails,
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
      config: {
        minimum_wrap_amount: config.general.minimumWrapAmount,
        hive_treasury: config.hive.treasury,
        operator_timeout_ms: config.network.operators.timeout,
      },
    })
  })

  app.get('/status', (_req, res) => {
    const connectedOperators = Array.from(operators.values()).filter(
      (op) => op.status() === 'CONNECTED'
    ).length
    res.json({
      status: 'OK',
      timestamp: Date.now(),
      uptime_ms: Date.now() - startedAt,
      bridge_health:
        connectedOperators >= hiveMultisigThreshold ? 'HEALTHY' : 'UNKNOWN',
    })
  })

  app.get('/pending-hive-wraps', (req, res) => {
    const { limit, offset, sort } = parsePagination(
      req.query as Record<string, unknown>
    )
    const allWraps = pendingWraps.getAllPendingWraps()
    const allHashes = Array.from(allWraps.keys())
    if (sort === 'desc') {
      allHashes.reverse()
    }
    const selectedHashes = allHashes.slice(offset, offset + limit)
    const wraps = pendingWraps.getWrapsByHashes(selectedHashes)
    res.setHeader('X-Total-Count', String(allHashes.length))
    res.setHeader('X-Limit', String(limit))
    res.setHeader('X-Offset', String(offset))
    res.setHeader('X-Sort', sort)
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
    // Ethereum address case
    if (userOrAddress.startsWith('0x')) {
      // Validate Ethereum address format
      if (!ethers.isAddress(userOrAddress)) {
        return res.status(400).json({ error: 'Invalid Ethereum address' })
      }
      const wraps = pendingWraps.getWrapsByAddress(
        ethers.getAddress(userOrAddress)
      )
      return res.json(wraps)
    }
    // Hive username
    if (!isHiveUsername(userOrAddress)) {
      return res.status(400).json({ error: 'Invalid Hive username' })
    }
    const wraps = pendingWraps.getWrapsByUsername(userOrAddress.toLowerCase())
    res.json(wraps)
  })

  app.get('/pending-hive-unwraps', (_req, res) => {
    const unwraps = Array.from(pendingUnwraps.getAllUnwraps()).map(
      ([trxHash, unwrap]) => ({
        trxHash,
        txId: unwrap.trx.digest().txId,
        timestamp: unwrap.timestamp,
        operators: unwrap.operators,
        signatures:
          unwrap.trx.transaction?.signatures.length ?? unwrap.operators.length,
        required_signatures: hiveMultisigThreshold,
        ready_to_broadcast: unwrap.hasEnoughSignatures(hiveMultisigThreshold),
      })
    )
    res.json(unwraps)
  })

  app.get('/peers', (_req, res) => {
    const peersArray = peers.getAllPeers()
    const temp: { id: string; address: string; isPublic: boolean }[] = []
    peersArray.forEach((peer) => {
      temp.push({
        id: peer.id,
        address: `${peer.ip}:${peer.port}` || '',
        isPublic: peer.isPublic,
      })
    })
    res.json(temp)
  })

  app.get('/proposals', (_req, res) => {
    const result = []
    for (const [, value] of proposals) {
      const requiredVotes =
        value.chain === 'HIVE'
          ? hiveMultisigThreshold
          : addedChainServices[value.chain].multisigThreshold
      result.push({
        proposalKey: value.proposalKey,
        chain: value.chain,
        method: value.method,
        target: value.target,
        nonce: value.nonce,
        blockNum: value.blockNum,
        createdAt: value.createdAt,
        votes_collected: value.signatures.size,
        votes_required: requiredVotes,
        signatures: Object.fromEntries(value.signatures),
      })
    }
    res.json(result)
  })

  app.get('/config', (_req, res) => {
    const chainDetails = Object.entries(addedChainServices).map(
      ([key, chainService]) => ({
        key,
        chain: chainService.name,
        symbol: chainService.symbol,
        contract: chainService.contractAddress,
      })
    )
    res.json({
      minimum_wrap_amount: config.general.minimumWrapAmount,
      hive_treasury: config.hive.treasury,
      hive_multisig_threshold: hiveMultisigThreshold,
      chains: chainDetails,
    })
  })
}
