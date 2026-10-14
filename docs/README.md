# Documentation

## Summary

These documents describe the production app, maintenance workflows, data formats, and runtime contracts.

Read in this order:

1. [architecture.md](./architecture.md)
2. the subsystem guide relevant to you
3. the source files linked from that guide

## Documents

- [architecture.md](./architecture.md)
  High level system map.
- [app-shell-and-routing.md](./app-shell-and-routing.md)
  App bootstrap, Home / Read / Simulation routes, shell behavior, persistent workspace routing, and retired-route redirects.
- [state-and-persistence.md](./state-and-persistence.md)
  Store structure, runtime materialization, persistence slices, and hydration behavior.
- [game-data-and-content-pipeline.md](./game-data-and-content-pipeline.md)
  Runtime data, registry initialization, authored content, and build scripts.
- [calculation-and-runtime-engine.md](./calculation-and-runtime-engine.md)
  Combat context building, formulas, simulation, effects, and rotation execution.
- [optimizer-and-suggestions.md](./optimizer-and-suggestions.md)
  Suggestions, workers, optimizer preparation and search, CPU and GPU execution, and result construction.
- [feature-surfaces.md](./feature-surfaces.md)
  The pages and features in the Home, Read, Simulation, Calibration, and System modules.
- [deployment-and-operations.md](./deployment-and-operations.md)
  Local development, Cloudflare deployment, OAuth, shares, sync, tracked build tools, and local maintenance workflows.
- [lifecycle-owners.md](./lifecycle-owners.md)
  Resource lifetimes for workers, caches, persistence coordination, editor retention, and GPU sessions.
