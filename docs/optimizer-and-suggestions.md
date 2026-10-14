# Optimizer Systems

## Runtime Assumption

These systems reuse the same canonical scenario and runtime assumptions as the rest of the simulation features:

- active resonator runtime
- team state
- enemy state
- shared effect resolution
- shared formula system

## Suggestions

Primary files:

- [src/engine/suggestions/core.ts](../src/engine/suggestions/core.ts)
- [src/engine/suggestions/mainStat-suggestion](../src/engine/suggestions/mainStat-suggestion)
- [src/engine/suggestions/setPlan-suggestion](../src/engine/suggestions/setPlan-suggestion)
- [src/engine/suggestions/worker.ts](../src/engine/suggestions/worker.ts)
- [src/modules/simulation/surfaces/suggestions/results](../src/modules/simulation/surfaces/suggestions/results)

Suggestion results depend on:

- selected target skill
- current runtime state
- set conditional state
- prepared scoring or ranking inputs

## Optimizer

Primary files:

- [src/engine/optimizer/engine.ts](../src/engine/optimizer/engine.ts)
- [src/engine/optimizer/compiler](../src/engine/optimizer/compiler)
- [src/engine/optimizer/search](../src/engine/optimizer/search)
- [src/engine/optimizer/results](../src/engine/optimizer/results)
- [src/engine/optimizer/workers](../src/engine/optimizer/workers)

The optimizer pipeline is:

1. compile raw start payload into a prepared optimizer payload
2. count or derive legal search space
3. choose candidate main echo indices
4. run worker coordinated search for those candidate groups
5. optionally use GPU accelerated target or rotation execution where available
6. materialize compact result refs into user facing loadout results

## Compile Stage

The compile stage is responsible for transforming app state into packed execution input:

- filtered inventory echoes
- mode specific packed execution payloads
- locked main candidate indices
- result limits
- packed context structures for target or rotation search

## CPU And GPU Execution

Primary directories:

- [src/engine/optimizer/cpu](../src/engine/optimizer/cpu)
- [src/engine/optimizer/gpu](../src/engine/optimizer/gpu)
- [src/engine/optimizer/shaders](../src/engine/optimizer/shaders)

CPU paths provide the baseline packed search execution.

GPU paths accelerate supported target and rotation workloads by:

- packing context data into GPU friendly buffers
- dispatching compute pipelines
- reducing candidate outputs

Worker orchestration decides when those paths are available and how progress is reported back to the store.

## Worker Model

Primary files:

- [src/engine/optimizer/workers/pool.ts](../src/engine/optimizer/workers/pool.ts)
- [src/engine/optimizer/workers/poolScheduler.ts](../src/engine/optimizer/workers/poolScheduler.ts)
- [src/engine/optimizer/workers/progressTracker.ts](../src/engine/optimizer/workers/progressTracker.ts)
- [src/engine/optimizer/workers/jobPreparation.ts](../src/engine/optimizer/workers/jobPreparation.ts)
- [src/engine/optimizer/workers/compile.worker.ts](../src/engine/optimizer/workers/compile.worker.ts)
- [src/engine/optimizer/workers/task.worker.ts](../src/engine/optimizer/workers/task.worker.ts)

## Result Materialization

Primary files:

- [src/engine/optimizer/results/materialize.ts](../src/engine/optimizer/results/materialize.ts)
- [src/engine/optimizer/results/collector.ts](../src/engine/optimizer/results/collector.ts)

## Store Coordination

Primary files:

- [src/application/state/storeOptimizerRuntime.ts](../src/application/state/storeOptimizerRuntime.ts)
- [src/application/state/store.ts](../src/application/state/store.ts)
- [src/application/state/optimizerSlice.ts](../src/application/state/optimizerSlice.ts)
- [src/application/state/optimizerRunStore.ts](../src/application/state/optimizerRunStore.ts)

The store layer handles:

- compile worker lifecycle
- run invalidation
- batch sizing
- progress updates
- final result application back into live runtime state

## Related Docs

- [architecture.md](./architecture.md)
- [calculation-and-runtime-engine.md](./calculation-and-runtime-engine.md)
- [feature-surfaces.md](./feature-surfaces.md)
