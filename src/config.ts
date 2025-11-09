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
    genesis: 100468956,
    // More than one so we can cross-check - todo in hive-tx: maybe implement quorum like ethers
    nodes: [
      'https://api.hive.blog',
      'https://api.deathwing.me',
      'https://rpc.mahdiyari.info',
      'https://techcoderx.com',
      'https://hiveapi.actifit.io',
      'https://api.c0ff33a.uk',
      'https://hive-api.3speak.tv',
    ],
    operator: {
      username: getEnv('USERNAME'),
      activeKey: getEnv('ACTIVE_KEY'),
    },
  },
  eth: {
    contract: {
      hive: '0x735F1732b84F46B2514B079B91455d4438243484',
      hbd: '0x3b962eC31324E29ad97fEe2Aab988B762a890888',
    },
    // Testing on sepolia
    // More than one so we can cross-check - quorum=2
    nodes: [
      'https://ethereum-sepolia-rpc.publicnode.com',
      'https://0xrpc.io/sep',
      'https://eth-sepolia.g.alchemy.com/v2/demo',
    ],
  },
}
