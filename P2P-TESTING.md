# P2P Network Testing Guide

## Quick Start

### Option 1: Interactive Testing (Manual)

Test the P2P network with an interactive CLI tool.

**Terminal 1 - Start first node:**
```bash
npm run test:p2p
# Or: npm run test:p2p -- 4001
```

**Terminal 2 - Start second node and connect to first:**
```bash
npm run test:p2p -- 4002 4001
```

**Terminal 3 - Start third node:**
```bash
npm run test:p2p -- 4003 4002
```

**Note:** Changed default port to 4000+ to avoid conflicts with your main app (port 3018).

**Available commands in the interactive prompt:**
- `peers` - List all connected peers
- `send <type>` - Broadcast a test message (e.g., `send HELLO`)
- `request peers` - Request peer list from network
- `stats` - Show network statistics
- `help` - Show help
- `exit` - Quit

### Option 2: Automated Testing

Run automated tests with 3 nodes:

```bash
tsx test-p2p-auto.ts
```

This will:
1. Start 3 nodes automatically
2. Connect them in a chain (A → B → C)
3. Test peer discovery (A and C discover each other)
4. Test message broadcasting
5. Clean up and exit

## Test Scenarios

### 1. Basic Connection Test
```bash
# Terminal 1
npm run test:p2p

# Terminal 2
npm run test:p2p -- 4001 4000
```

Then in Terminal 1, type:
```
peers
```

You should see the peer from Terminal 2 connected.

### 2. Message Broadcasting Test
```bash
# In any terminal with a running node
P2P> send TEST_MESSAGE
```

All connected peers should receive the message.

### 3. Peer Discovery Test

Start 3 nodes: A(4000) ← B(4001) ← C(4002)

```bash
# Terminal 1
npm run test:p2p

# Terminal 2
npm run test:p2p -- 4001 4000

# Terminal 3
npm run test:p2p -- 4002 4001
```

In Node C terminal:
```
P2P> request peers
P2P> peers
```

Node C should discover Node A through Node B.

### 4. Message Deduplication Test

Send the same message from multiple nodes - each node should only process it once (check logs for "already seen this message").

### 5. Rate Limiting Test

Rapidly send many messages:
```bash
P2P> send SPAM
P2P> send SPAM
P2P> send SPAM
# ... repeat quickly
```

Should see rate limit warnings after exceeding the limit.

### 6. Message Size Limit Test

You can test this programmatically by modifying the test script to send a large message.

## What to Look For

### ✅ Success Indicators
- Nodes connect successfully
- Handshake completes (HELLO/HELLO_ACK)
- Peers appear in the peer list
- Messages broadcast to all connected peers
- Peer discovery works (nodes find each other transitively)
- Message deduplication prevents loops

### ❌ Failure Indicators
- Connection timeout
- Handshake failures
- Messages not received by all peers
- Duplicate message processing
- Rate limit not enforced
- Large messages not rejected

## Debugging Tips

### Enable Debug Logging
The test tool already sets `logLevel: 'debug'`. Check the console output for detailed information.

### Monitor Network Traffic
```bash
# In another terminal, monitor WebSocket traffic
npx wscat -c ws://127.0.0.1:4000
```

### Check Connection State
```bash
# In the P2P> prompt
stats
peers
```

### Common Issues

**"Connection refused"**
- Make sure the target node is running
- Check the port number is correct
- Ensure no firewall blocking

**"Address already in use" / EADDRINUSE**
- Each node needs a unique port
- Check if another process is using the port: `lsof -i :4000`
- Kill the process or use a different port

**"Handshake timeout"**
- Check network connectivity
- Verify the peer is responsive
- Look for errors in the peer's logs

**"Already connected"**
- Normal - means you tried to connect to a peer you're already connected to
- Check with `peers` command

**"Rate limit exceeded"**
- Intentional - you're sending too many messages
- Adjust `messageRateLimit` in config if needed

## Integration with Your App

To test with your actual application:

1. Start your main app:
   ```bash
   npm run dev
   ```

2. Start a test node that connects to it:
   ```bash
   npm run test:p2p -- 3001 3018
   # 3018 is your app's default port
   ```

3. Send messages between them and verify they're processed correctly.

## Clean Up

Kill all test nodes:
```bash
# Ctrl+C in each terminal
# Or:
pkill -f "tsx test-p2p"
```
