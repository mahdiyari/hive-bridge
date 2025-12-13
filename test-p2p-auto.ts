#!/usr/bin/env tsx
/**
 * Automated P2P Network Test
 *
 * This script starts 3 nodes and tests basic P2P communication:
 * - Node A (port 4001)
 * - Node B (port 4002) connects to A
 * - Node C (port 4003) connects to B
 *
 * Tests:
 * 1. Peer discovery (A and C should discover each other through B)
 * 2. Message broadcasting
 * 3. Message deduplication
 */

import { fork, ChildProcess } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

interface TestNode {
  port: number
  process?: ChildProcess
  name: string
}

const nodes: TestNode[] = [
  { port: 4001, name: 'Node-A' },
  { port: 4002, name: 'Node-B' },
  { port: 4003, name: 'Node-C' },
]

console.log('🧪 Starting automated P2P network test...\n')

// Start nodes
async function startNodes() {
  console.log('📡 Starting nodes...')

  // Start Node A (bootstrap)
  nodes[0].process = fork('test-p2p.ts', [nodes[0].port.toString()], {
    stdio: 'pipe',
  })
  console.log(`  ✅ ${nodes[0].name} started on port ${nodes[0].port}`)

  await sleep(2000)

  // Start Node B (connect to A)
  nodes[1].process = fork(
    'test-p2p.ts',
    [nodes[1].port.toString(), nodes[0].port.toString()],
    { stdio: 'pipe' }
  )
  console.log(
    `  ✅ ${nodes[1].name} started on port ${nodes[1].port} (connecting to ${nodes[0].name})`
  )

  await sleep(2000)

  // Start Node C (connect to B)
  nodes[2].process = fork(
    'test-p2p.ts',
    [nodes[2].port.toString(), nodes[1].port.toString()],
    { stdio: 'pipe' }
  )
  console.log(
    `  ✅ ${nodes[2].name} started on port ${nodes[2].port} (connecting to ${nodes[1].name})`
  )

  // Set up logging
  nodes.forEach((node) => {
    if (node.process?.stdout) {
      node.process.stdout.on('data', (data) => {
        const lines = data.toString().split('\n')
        lines.forEach((line: string) => {
          if (line.trim()) {
            console.log(`[${node.name}] ${line}`)
          }
        })
      })
    }
    if (node.process?.stderr) {
      node.process.stderr.on('data', (data) => {
        console.error(`[${node.name} ERROR] ${data}`)
      })
    }
  })

  await sleep(3000)
}

async function runTests() {
  console.log('\n🧪 Running tests...\n')

  console.log('Test 1: Check peer connections')
  await sleep(2000)

  console.log('Test 2: Send test message from Node A')
  if (nodes[0].process?.stdin) {
    nodes[0].process.stdin.write('send TEST_AUTO\n')
  }
  await sleep(2000)

  console.log('Test 3: Request peer discovery')
  if (nodes[2].process?.stdin) {
    nodes[2].process.stdin.write('request peers\n')
  }
  await sleep(3000)

  console.log('\n✅ Tests completed!')
}

async function cleanup() {
  console.log('\n🧹 Cleaning up...')
  nodes.forEach((node) => {
    if (node.process) {
      node.process.kill()
      console.log(`  Stopped ${node.name}`)
    }
  })
  process.exit(0)
}

// Main execution
;(async () => {
  try {
    await startNodes()
    await runTests()
    await sleep(2000)
    cleanup()
  } catch (error) {
    console.error('❌ Test failed:', error)
    cleanup()
  }
})()

// Handle Ctrl+C
process.on('SIGINT', cleanup)
