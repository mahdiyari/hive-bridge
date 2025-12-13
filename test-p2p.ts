#!/usr/bin/env tsx
/**
 * Simple P2P Network Test Tool
 *
 * Usage:
 *   PORT=3001 npm run test:p2p                    # Start on port 3001
 *   PORT=3002 PEERS=127.0.0.1:3001 npm run test:p2p  # Connect to 3001
 *
 * Or use command line:
 *   npm run test:p2p               # Start a node on default port (4000)
 *   npm run test:p2p -- 4001       # Start on specific port
 *   npm run test:p2p -- 4001 4000  # Start on 4001 and connect to 4000
 */

import readline from 'node:readline'

// Parse arguments
const port = parseInt(process.argv[2] || process.env.PORT || '4000')
const connectTo = process.argv[3] || process.env.PEERS

// Set environment variables BEFORE importing anything
process.env.PORT = port.toString()
process.env.HOST = '127.0.0.1' // Use localhost instead of :: for testing
process.env.LOG_LEVEL = 'debug'
if (connectTo) {
  if (connectTo.includes(':')) {
    process.env.PEERS = connectTo
  } else {
    process.env.PEERS = `127.0.0.1:${connectTo}`
  }
}

// NOW import the P2P network (after env vars are set)
const { p2pNetwork } = await import('./src/network/P2PNetwork.js')
const { peers } = await import('./src/network/Peers.js')
const { messageList } = await import('./src/network/messageList.js')

console.log('\n=== P2P Network Test Tool ===')
console.log(`Port: ${port}`)
console.log(`Host: 127.0.0.1`)
if (connectTo) {
  console.log(`Connecting to: ${process.env.PEERS}`)
}
console.log('=============================\n')

// Start the network
p2pNetwork.start()

// Listen to messages
p2pNetwork.onMessage((detail) => {
  console.log('\n📨 Received message:')
  console.log('  From:', detail.sender)
  console.log('  Type:', detail.data.type)
  console.log('  Data:', JSON.stringify(detail.data, null, 2))
})

// Interactive CLI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\nP2P> ',
})

console.log('\nAvailable commands:')
console.log('  peers           - List connected peers')
console.log('  send <type>     - Broadcast a test message')
console.log('  request peers   - Request peer list')
console.log('  stats           - Show network stats')
console.log('  help            - Show this help')
console.log('  exit            - Quit')

rl.prompt()

rl.on('line', (line) => {
  const [cmd, ...args] = line.trim().split(/\s+/)

  switch (cmd) {
    case 'peers': {
      const allPeers = peers.getAllPeers()
      const publicPeers = peers.getPublicPeers()
      const privatePeers = peers.getPrivatePeers()

      console.log(`\n📊 Connected Peers: ${allPeers.length}`)
      console.log(`   Public: ${publicPeers.length}`)
      publicPeers.forEach((p, i) => {
        console.log(`     ${i + 1}. ${p.id.slice(0, 8)}... @ ${p.address}`)
      })
      console.log(`   Private: ${privatePeers.length}`)
      privatePeers.forEach((p, i) => {
        console.log(`     ${i + 1}. ${p.id.slice(0, 8)}...`)
      })
      break
    }

    case 'send': {
      const type = args[0] || 'TEST_MESSAGE'
      const testMessage = {
        type,
        data: {
          message: 'Hello from test tool!',
          timestamp: Date.now(),
          random: Math.random(),
        },
      }

      p2pNetwork.sendMessage(testMessage as any)
      console.log(`✅ Broadcasted ${type} to all peers`)
      break
    }

    case 'request': {
      if (args[0] === 'peers') {
        messageList.REQUEST_PEERS()
        console.log('✅ Requested peer list from network')
      } else {
        console.log('❌ Unknown request. Try: request peers')
      }
      break
    }

    case 'stats': {
      const allPeers = peers.getAllPeers()
      console.log('\n📊 Network Statistics:')
      console.log(`   Total peers: ${allPeers.length}`)
      console.log(`   Public peers: ${peers.getPublicPeers().length}`)
      console.log(`   Private peers: ${peers.getPrivatePeers().length}`)
      console.log(`   Node port: ${port}`)
      break
    }

    case 'help':
      console.log('\nAvailable commands:')
      console.log('  peers           - List connected peers')
      console.log('  send <type>     - Broadcast a test message')
      console.log('  request peers   - Request peer list')
      console.log('  stats           - Show network stats')
      console.log('  help            - Show this help')
      console.log('  exit            - Quit')
      break

    case 'exit':
      console.log('👋 Goodbye!')
      process.exit(0)

    case '':
      break

    default:
      console.log(
        `❌ Unknown command: ${cmd}. Type 'help' for available commands.`
      )
  }

  rl.prompt()
})

rl.on('close', () => {
  console.log('\n👋 Goodbye!')
  process.exit(0)
})

// Handle shutdown gracefully
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...')
  process.exit(0)
})
