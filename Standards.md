Below are notes written during development. Might not be fully accurate right
now.

---

### Wrapping HIVE/HBD

Transfer operation to the bridge account with the following memo structure:

```
ETH:[eth address]
```

For example:

```
{
  "amount": "0.001 HIVE",
  "from": "mahdiyari",
  "memo": "ETH:0x95222290DD7278Aa3Ddd389Cc1E1d165CC4BAfe5",
  "to": "bridge-treasury"
}
```

The operators/witnesses will sign a message that will let the user mint the
wrapped tokens (WHIVE in this case) on the ETH blockchain by interacting with
the contract.\
A UI will handle everything for the user.\
The user must mint the tokens in a timly manner (or save the signatures for
later use).\
Currently operators wont be keeping the track of the pending wraps older than 14
days.

### Unwrapping WHIVE/WHBD

The ETH contract has a function that lets users unwrap their WHIVE. The
operators will watch the ETH network and transfer HIVE/HBD to the users' Hive
account upon successful burn of the WHIVE/WHBD tokens by the smart contract
(after 12 confirmations).

### P2P Messages

```ts
{
	type: string
	data: object
	timestamp: number
	hash: string
}
```

#### Handshakes

```ts
// Send HELLO
{
	type: 'HELLO'
	data: {
		peerId: string
		address: string
	}
	timestamp: number
	hash: string
}
// Receive HELLO_ACK
{
	type: 'HELLO_ACK'
	data: {
		peerId: string
	}
	timestamp: number
	hash: string
}
```

#### Signature

```ts
{
	type: '[HIVE_ETH]_SIGNATURE'
	data: {
		...
	}
	timestamp: number
	hash: string
}
```

#### Heartbeat

```ts
// Every 90s broadcasted by the operators
{
	type: 'HEARTBEAT'
	data: {
		...
	}
	timestamp: number
	hash: string
}
```

### PeerList

### RequestPeers

<!-- #### Announce Operator
```ts
{
  type: 'ANNOUNCE_OPERATOR'
  data: {
    operator: string
    peerId: string
    targetId: string
    signature: string
  }
  timestamp: number
  hash: string
}
``` -->
