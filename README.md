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

# Development

To add a new chain or L2, take inspiration from `/src/blockchain/ethereum/EthereumService.ts`.  
All blockchain services must satisfy `ChainService` interface and initiated in `/src/blockchain/index.ts`.
