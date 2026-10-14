# State And Persistence

## Persisted State

Primary files:

- [src/domain/entities/appState.ts](../src/domain/entities/appState.ts)
- [src/application/state/store.ts](../src/application/state/store.ts)
- [src/application/state/optimizerRunStore.ts](../src/application/state/optimizerRunStore.ts)
- [src/application/state/inventoryUiStore.ts](../src/application/state/inventoryUiStore.ts)
- [src/engine/runtime/schema.ts](../src/engine/runtime/schema.ts)
- [src/application/persistence/storage.ts](../src/application/persistence/storage.ts)
- [src/application/persistence/scenarioRecords.ts](../src/application/persistence/scenarioRecords.ts)
- [src/application/persistence/persistenceCoordinator.ts](../src/application/persistence/persistenceCoordinator.ts)
- [src/application/persistence/storageCodec.ts](../src/application/persistence/storageCodec.ts)
- [src/application/persistence/legacyMigration.ts](../src/application/persistence/legacyMigration.ts)

Current persisted roots are:

- `ui`: appearance, layout, Modulation and Showcase preferences, editor preferences, and picker memory
- `combat`: canonical scenarios and selected scenario
- `simulation`: optimizer settings and suggestion state
- `library`: saved Echoes, builds, rotations, and scenarios

## Granular Storage Domains

The storage layer writes explicit domains:

- `ui.appearance`
- `ui.layout`
- `ui.showcaseCards`
- `ui.savedRotationPreferences`
- `combat.workspace`
- `simulation.optimizerSettings`
- `simulation.suggestions`
- `library.echoes`
- `library.builds`
- `library.rotations`
- `library.scenarios`

## Runtime Materialization

Primary files:

- [src/engine/runtime/runtimeAdapters.ts](../src/engine/runtime/runtimeAdapters.ts)
- [src/engine/runtime/runtimeMaterialization.ts](../src/engine/runtime/runtimeMaterialization.ts)
- [src/engine/runtime/combatGraph.ts](../src/engine/runtime/combatGraph.ts)

Runtime adapters convert saved scenario members, team assignments, controls, and conditions into calculation inputs for each resonator and teammate. Selectors provide those inputs to the simulation systems.

## Transient State

`optimizerRunStore` stores optimizer progress and results; `inventoryUiStore` stores inventory panel state.

## Writeback And Recovery

App providers debounce changed-domain writes and flush them on page hide and `beforeunload`. Before applying loaded data, most structured slices validate with Zod; Showcase cards and scenario records use dedicated readers. A failed write is reported per domain, and subsequent domains are still saved. Legacy version keys and recovery records support migration and cleanup.

## Related Docs

- [architecture.md](./architecture.md)
- [app-shell-and-routing.md](./app-shell-and-routing.md)
- [feature-surfaces.md](./feature-surfaces.md)
