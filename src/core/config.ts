import { configDotenv } from 'dotenv'

configDotenv({ quiet: true })

const getEnv = (name: string) => {
  return process.env[name]?.replaceAll('"', '').trim()
}

export const config = {
  general: {
    logLevel: getEnv('LOG_LEVEL') || 'info',
    host: getEnv('HOST') || '::',
    port: Number(getEnv('PORT')) || 3018,
    knownPeers: getEnv('PEERS'),
  },
  hive: {
    treasury: 'bridge4',
    genesis: 102501800,
    // More than one so we can cross-check
    nodes: [
      'https://api.hive.blog',
      'https://api.deathwing.me',
      'https://rpc.mahdiyari.info',
      'https://techcoderx.com',
      'https://hiveapi.actifit.io',
      'https://api.c0ff33a.uk',
      'https://api.openhive.network',
    ],
    operator: {
      username: getEnv('USERNAME'),
      activeKey: getEnv('ACTIVE_KEY'),
    },
    transaction: {
      // Transaction expiration for unwraps (max currently 24 hours)
      expirationMs: 86_300_000,
    },
  },
  eth: {
    contract: {
      hive: '0x4A63078adf964Fd28cFB098F40d04A84c9cC80dd',
      hbd: '0xE64235C82C4cb9bfba6c3F821e56B1FB59c70BE5',
    },
    // Testing on sepolia
    // More than one so we can cross-check - quorum=2
    nodes: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      // 'https://0xrpc.io/sep',
      'https://ethereum-sepolia-public.nodies.app',
      'https://eth-sepolia.api.onfinality.io/public',
    ],
  },
  network: {
    p2p: {
      heartbeatInterval: 20_000, // 20 seconds
      maxPeers: 10,
      messageRateLimit: 50, // per second
      handshakeTimeout: 5_000, // 5 seconds
      peerCheckInterval: 60_000, // 1 minute
      peerDiscoverySleepMs: 500,
      maxMessageSize: 1024 * 10, // 10 KB
    },
    operators: {
      timeout: 30_000, // 30 seconds
      updateInterval: 60_000, // 1 minute
    },
    message: {
      maxAgeMs: 8_000, // 8 seconds
      seenListLifespanMs: 10_000, // 10 seconds
    },
  },
}
