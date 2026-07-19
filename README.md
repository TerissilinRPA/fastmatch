# Fastmatch

Data analytics for Fastwork Job Board — DIEL-inspired interactive charts, k-means clustering, pricing bands (under / fair / over), and AI replaceability notes.

## Features

- Seeded from `data/jobs.json` (exported Fastwork CSV)
- `/api/sync` — newest-first fetch; **stops when a known job id appears** (reconcile)
- `/api/dashboard` — clustering + pricing analytics
- `/api/analyze` — Thai market narrative + opportunities
- Client DIEL engine: event log + BindOutput-style chart updates

## Local

```bash
npm install
cp .env.example .env.local   # set FASTWORK_TOKEN
npm run dev
```

## Sync test

```bash
curl -X POST http://localhost:3000/api/sync \
  -H "content-type: application/json" \
  -d "{\"token\":\"YOUR_BEARER\"}"
```

## Deploy

```bash
vercel --prod
vercel env add FASTWORK_TOKEN
```
