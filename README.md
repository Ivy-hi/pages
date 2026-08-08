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

## Photo Publishing

On macOS, double-click `publish-photo.command`, choose a photograph, and enter
its caption and visual description. The publisher will:

1. resize the longest edge to 3200 px without upscaling;
2. save an optimized JPEG at quality 82;
3. append the photo to `src/data/photos.json`;
4. run the production build and tests;
5. commit and push `local`;
6. merge through a temporary worktree and push `main`;
7. wait until the photograph appears on `https://www.hanyi.life`.

The same workflow is available in Terminal:

```sh
npm run photo:publish -- "/path/to/photo.jpg"
```

For agent or non-interactive use:

```sh
npm run photo:publish -- "/path/to/photo.jpg" \
  --caption "At the doorway" \
  --alt "A weathered tiled doorway in an old neighborhood" \
  --yes
```

Use `--prepare-only` to update, verify, and commit the site locally without
publishing. Run `npm run photo:release` when that local commit is ready, or use
the same command to retry after a GitHub or Cloudflare failure. The publisher
ignores untracked files, but stops if tracked files already have changes.

## Writing Plog Entries

Create Markdown files in `src/content/plog`. Use `lang: zh-CN` for Chinese
entries so the page uses the Chinese font, date format, interface labels, and
document language:

```yaml
---
title: 一次散步
description: 关于光线、街道和一张照片的短记。
pubDate: 2026-08-08
lang: zh-CN
cover: ../../assets/photography/example.jpg
coverAlt: 傍晚街道上的行人与灯光
draft: false
---
```

Use `lang: en` for English entries. Existing entries default to English when
the field is omitted.
