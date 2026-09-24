# Confluence

USDC cross-chain bridge centered on Arc, built on Circle App Kit (CCTP).

- `confluence-web/` - Next.js 16 frontend (Vercel)
- `confluence-api/` - Express 5 backend (Render)

Both packages pin Node `>=24.14.1 <25`.

## Local development

```bash
cd confluence-api && npm install && npm run dev   # http://localhost:4000/health
cd confluence-web && npm install && npm run dev   # http://localhost:3000
```
