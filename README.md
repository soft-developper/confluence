# Confluence

USDC cross-chain bridge centered on Arc, built on Circle App Kit (CCTP).

- `confluence-web/` - Next.js 16 frontend (Vercel)
- `confluence-api/` - Express 5 backend (Render)

Both packages pin Node `>=24.14.1 <25`.

## Local development

Each package reads its own env file. Copy the examples first:

```bash
cp confluence-api/.env.example confluence-api/.env
cp confluence-web/.env.example confluence-web/.env.local
```

```bash
cd confluence-api && npm install && npm run dev   # http://localhost:4000/health
cd confluence-web && npm install && npm run dev   # http://localhost:3000
```

Database (Turso, one database per environment). Put the testnet database URL and token in `confluence-api/.env`, then apply migrations:

```bash
cd confluence-api && npm run db:migrate
```

Schema changes: edit `src/db/schema.ts`, run `npm run db:generate`, commit the new file in `drizzle/`, then `npm run db:migrate`.

Wallets: wagmi v3 with browser wallets (EIP-6963), Coinbase Wallet and WalletConnect. WalletConnect needs `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (Reown dashboard) and your domains on the Reown allowlist; without it the option is hidden.

`CONFLUENCE_ENV` (API) and `NEXT_PUBLIC_CONFLUENCE_ENV` (web) must match. The home page shows an alert if they don't.

## API endpoints

- `GET /health` - service, environment and database status (503 when the database is unreachable)
- `POST /quotes` - bridge quote: platform fee (0.30 USDC up to 1,000; 0.10% above), Circle CCTP and Forwarding fee estimates from the CCTP API, total debit, expected receive, and the `customFee` for App Kit. Valid 60s, 60/min per wallet.
- `GET /fees/max-amount?balance=<base units>` - largest amount whose amount + platform fee fits the balance (powers the Max button).
- `GET /chains` - bridge chains for this environment, built from Circle App Kit `getSupportedChains("bridge")` (EVM only in v1), with Fast and Standard attestation times from Circle's finality docs (`src/chains/finality.ts`)

## Rate limits and idempotency

- Per IP: 100 requests/min on every route except `/health` (429 + `Retry-After`, `RateLimit` headers).
- Per wallet: 60 quotes/min and 10 transfer creations/min (applied to those routes in Stage 2).
- Outbound to Circle: token bucket, `CIRCLE_MAX_RPS` per second.
- Counters are in memory (one API instance). Before scaling out, swap the store in `src/middleware/rateLimits.ts` (`createStore`).
- Create endpoints require an `Idempotency-Key` header; see `src/middleware/idempotency.ts`.
- `TRUST_PROXY_HOPS`: 0 locally, 3 on Render (Cloudflare, Render load balancer, local proxy; verified live). A warning is logged if the resolved client IP is ever private.

## Fee recipient

Set once per environment (writes the Turso database in `.env`):

```bash
cd confluence-api && npm run fees:set-recipient -- 0xYourFeeAddress
```
