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

`CONFLUENCE_ENV` (API) and `NEXT_PUBLIC_CONFLUENCE_ENV` (web) must match. The home page shows an alert if they don't.

## API endpoints

- `GET /health` - service, environment and database status (503 when the database is unreachable)
- `GET /chains` - bridge chains for this environment, built from Circle App Kit `getSupportedChains("bridge")` (EVM only in v1), with Fast and Standard attestation times from Circle's finality docs (`src/chains/finality.ts`)
