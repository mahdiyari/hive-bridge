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
    minimumWrapAmount: 10, // 10 HIVE/HBD
    // Need to remove old pending wraps to prevent excess RAM usage
    // Someone could spam small transfers and increase the size of pendingHiveWraps variable
    // 7 days should be safe enough
    wrapCutoff: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
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
    testing: true,
    // Testing on sepolia
    sepolia: {
      contract: {
        hive: '0xc27F641264023eEBfE100F43A6BDA1B5546d8cd2',
        hbd: '0x88A8BFef536594416dE82A75e6E9be7c27dF39d8',
      },
      // More than one so we can cross-check - quorum=2
      nodes: [
        'https://ethereum-sepolia-rpc.publicnode.com',
        // 'https://ethereum-sepolia-public.nodies.app',
        'https://lb.routeme.sh/rpc/evm/11155111',
      ],
    },
    mainnet: {
      contract: {
        hive: '0x0000',
        hbd: '0x0000',
      },
      // More than one so we can cross-check - quorum=2
      // There are also other free rpc nodes like Infura but require registration
      // Bad nodes will spam the logs but shouldn't affect any functionality
      nodes: [
        'https://eth1.lava.build',
        'https://eth.rpc.blxrbdn.com',
        'https://ethereum-rpc.publicnode.com',
        'https://ethereum.public.blockpi.network/v1/rpc/public',
        'https://eth.api.pocket.network',
        'https://rpc.eth.gateway.fm',
        'https://public-eth.nownodes.io',
        'https://rpc.fullsend.to',
        'https://rpc.mevblocker.io/fast',
      ],
    },
  },
  network: {
    p2p: {
      heartbeatInterval: 20_000, // 20 seconds
      maxPeers: 18,
      messageRateLimit: 100, // per second
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
