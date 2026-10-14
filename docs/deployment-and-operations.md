# Deployment And Operations

## Local Development

Primary files:

- [package.json](../package.json)
- [vite.config.ts](../vite.config.ts)
- [wrangler.jsonc](../wrangler.jsonc)

Core requirements:

- Node `24.x`

Core local commands:

```bash
npm install
npm run dev
npm run build
npm test
npm run lint
```

Cloudflare local development:

```bash
npm run dev:cloudflare
```

## Production Deployment

Primary files:

- [src/cloudflare/worker.ts](../src/cloudflare/worker.ts)
- [wrangler.jsonc](../wrangler.jsonc)
- [public/_headers](../public/_headers)

Production uses:

- static assets from `dist`
- Cloudflare asset serving with SPA fallback
- a Cloudflare Worker for OAuth and share `/api/*` endpoints

The Worker handles these API routes:

- `/api/exchange-code`
- `/api/refresh-token`
- `/api/shares`
- `/api/shares/*`

Everything else falls back to static asset serving.

## Environment Variables

Important variables visible in the repo:

- `VITE_GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `SHARES` KV namespace binding

Configuration uses:

- `VITE_*` values for browser side configuration
- server side values for OAuth exchange and refresh handling
- `SHARES` for production share payload persistence

The `beta` Wrangler environment is a frontend-only preview with no OAuth variables or `SHARES` binding. Production requires the public client and redirect variables, the `GOOGLE_CLIENT_SECRET` secret, and the KV binding.

## Google Drive Sync

Primary roots:

- [src/infra/googleDrive](../src/infra/googleDrive)
- [src/infra/googleDrive/server](../src/infra/googleDrive/server)

Drive sync behavior depends on:

- browser side auth setup
- token exchange and refresh endpoints
- persistence snapshot serialization
- restore and backup actions in Calibration

Drive sync backs up and restores the same data saved locally by the app.

## Persistence Operations

Primary roots:

- [src/application/persistence](../src/application/persistence)
- [src/infra/persistence](../src/infra/persistence)
- [src/engine/runtime/schema.ts](../src/engine/runtime/schema.ts)

`src/application/persistence` handles app-state domains, migration, scenario records, codecs, and coordinated writes; `src/infra/persistence` handles browser storage such as IndexedDB-backed image blobs and beta-notice acknowledgement.

Operational persistence concerns include:

- schema versioning
- legacy backup handling
- recovery keys
- per domain slice reads and writes
- hydration and repair behavior after bad local data

Deployment or browser changes affecting persistence require validation of stored data and migration paths.

## Maintenance Tools And Local Scripts

Tracked build utilities:

- [tools/data](../tools/data)
- [tools/seo](../tools/seo)

## Related Docs

- [architecture.md](./architecture.md)
- [game-data-and-content-pipeline.md](./game-data-and-content-pipeline.md)
- [state-and-persistence.md](./state-and-persistence.md)
