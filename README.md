# hive-bridge

```sh
cp example.env .env
```

### option 1:

```sh
docker compose up --build -d
```

### option 2:

```sh
# node v22
npm install
npm run start
```

---

### IPv6-only systems:

The software "works" on IPv6-only systems and has proper IPv6 handling but the problem can be the blockchain RPC nodes. Not all of them support IPv6 and that can cause serious problems. This ignores the fact that you can't even download this repository on IPv6-only systems because GitHub doesn't support IPv6 as of 2026. So the recommendation is to have IPv4 connectivity.

---

# Development

To add a new chain or L2, take inspiration from `/src/blockchain/ethereum/EthereumService.ts`.  
All blockchain services must satisfy `ChainService` interface and initiated in `/src/blockchain/index.ts`.  
Configs are located at `/src/core/config.ts`.
