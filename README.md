# Agent Scheduler

An Astro + Cloudflare Pages personal coordination dashboard. The public site stays static; `/api/v1/*` runs on Cloudflare Pages Functions and stores state in Cloudflare D1.

## Local Development

```sh
npm install
cp .dev.vars.example .dev.vars
npm run build
npm run d1:apply:local
npm run pages:dev
```

Open `http://localhost:8788/dashboard` after `wrangler pages dev` starts.

## Cloudflare Setup

1. Create a D1 database:

```sh
npx wrangler d1 create agent-scheduler
```

2. Copy the returned `database_id` into `wrangler.toml`.

3. Apply the remote migration:

```sh
npm run d1:apply:remote
```

4. Add Cloudflare Pages environment secrets:

```sh
npx wrangler pages secret put ADMIN_PASSWORD
npx wrangler pages secret put SESSION_SECRET
```

5. Configure Cloudflare Pages:

```text
Build command: npm run build
Build output: dist
```

`public/_routes.json` limits Function execution to `/api/v1/*`.

## Agent API

Create an agent key in `/dashboard`. Store the returned key once; only its SHA-256 hash is saved.

Read the current scheduling state:

```sh
curl https://your-domain.example/api/v1/agent/snapshot \
  -H "Authorization: Bearer ag_xxx"
```

Create a pending proposal:

```sh
curl https://your-domain.example/api/v1/agent/proposals \
  -H "Authorization: Bearer ag_xxx" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: unique-agent-operation-id" \
  -d '{
    "type": "task",
    "payload": {
      "title": "Draft weekly plan",
      "description": "Collect open work and prepare priorities.",
      "priority": "P1",
      "estimate_minutes": 45
    }
  }'
```

Supported proposal types are `task`, `calendar_block`, and `project_update`.

## Verification

```sh
npm test
npm run build
```
