# The Wuwa Calculator

Hi, this is a fan made tools for planning, simulating, and optimizing builds in *Wuthering Waves*.

## Environment

Local Google Drive sync and OAuth flows expect:

```bash
VITE_GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=...
```

Browser side configuration uses `VITE_*` values. Server side OAuth exchange and refresh use the non `VITE_*` variables.

## Repo Map

- `src/app`
  App bootstrap, providers, and router wiring.
- `src/data`
  Checked in content plus game data bootstrap and catalog loaders.
- `src/domain`
  Durable entities, game-data contracts, pure value types, and domain services.
- `src/engine`
  Formulas, effects, simulation, suggestions, parser logic, and optimizer execution.
- `src/infra`
  Browser-platform storage, Google Drive sync, OAuth and share server handlers, cookies, and analytics.
- `src/modules/home`
  The Home page.
- `src/modules/read`
  Docs, guides, changelog, and information pages.
- `src/modules/simulation`
  Modulation, Rotation, Showcase, Optimizer, Suggestions, and their shared workspace features.
- `src/modules/calibration` and `src/modules/system`
  Appearance, app preferences, data management, and system fallback pages.
- `src/shared`
  Shared UI primitives, shell components, and low level helpers.
- `public/data`
  Checked-in, mode-scoped runtime JSON used by core startup and lazy Simulation data loading.
- `docs`
  Documentation for maintainers.

## Documentation

Start here:

- [docs/README.md](./docs/README.md)
- [docs/architecture.md](./docs/architecture.md)

Key subsystem references:

- [app shell and routing](./docs/app-shell-and-routing.md)
- [state and persistence](./docs/state-and-persistence.md)
- [game data and content pipeline](./docs/game-data-and-content-pipeline.md)
- [calculation and runtime engine](./docs/calculation-and-runtime-engine.md)
- [optimizer and suggestions](./docs/optimizer-and-suggestions.md)
- [feature surfaces](./docs/feature-surfaces.md)
- [deployment and operations](./docs/deployment-and-operations.md)
- [resource lifecycle owners](./docs/lifecycle-owners.md)

## Deployment

The app deploys as a Cloudflare Worker with static assets from `dist`. The Worker handles Google OAuth exchange and refresh endpoints plus share creation and retrieval under `/api/shares`; production shares use the `SHARES` KV binding.

Basic deploy flow:

```bash
npm install
npx wrangler secret put GOOGLE_CLIENT_SECRET
npm run deploy:cloudflare
```

The public Google client ID and redirect URI are configured as Worker variables. `GOOGLE_CLIENT_SECRET` must remain a secret, and the production `SHARES` KV namespace must be bound before share links can work.

Deployment configuration is in [wrangler.jsonc](./wrangler.jsonc). Cross origin isolation headers are defined in [public/_headers](./public/_headers).

## License

This project is source available, not open source. See [LICENSE.md](./LICENSE.md) for the full terms.

In short, the code is provided for reference and educational use only. You may view and study it, but you may not copy, modify, redistribute, sublicense, or reuse substantial portions of it without prior written permission from the author.

## Project Notes

- unofficial fan project, not affiliated with Kuro Games
- designed, coded, and maintained by [`ssjrunor`](https://whoami.ssjrunor.com/)
- gameplay values are based on in game inspection plus community maintained sources and testing

## Contact

Discord:

- https://discord.gg/wNaauhE4uH
