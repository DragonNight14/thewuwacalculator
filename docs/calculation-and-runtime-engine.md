# Calculation And Runtime Engine

## Main Execution Flow

Primary files:

- [src/engine/pipeline/index.ts](../src/engine/pipeline/index.ts)
- [src/engine/pipeline/buildCombatContext.ts](../src/engine/pipeline/buildCombatContext.ts)
- [src/engine/pipeline/simulateRotation.ts](../src/engine/pipeline/simulateRotation.ts)
- [src/engine/pipeline/prepareRuntimeSkill.ts](../src/engine/pipeline/prepareRuntimeSkill.ts)
- [src/engine/rotation/execute.ts](../src/engine/rotation/execute.ts)

The general execution flow is:

1. build or reuse a combat graph
2. select a target slot
3. build a combat context for that slot
4. resolve effects, stats, and routing
5. prepare runtime skills and rows
6. simulate direct results or rotation results
7. optionally inspect node level execution traces

`runResSmlt()` accepts an active runtime and team context; `runCmbtGrphS()` accepts an existing graph and target slot. Both prepare the graph and combat context before calling `smltRot()`.

## Combat Graph

Primary files:

- [src/domain/entities/combatGraph.ts](../src/domain/entities/combatGraph.ts)
- [src/engine/runtime/combatGraph.ts](../src/engine/runtime/combatGraph.ts)

The transient combat graph contains participants, runtime state, slot assignments, and targets; it is not persisted app state.

Important responsibilities:

- represent participants by slot
- store runtime references for active and teammate contexts
- preserve target routing information
- provide enough structure for shared combat context building

## Combat Context

Primary file:

- [src/engine/pipeline/buildCombatContext.ts](../src/engine/pipeline/buildCombatContext.ts)

The combat context contains the resolved inputs used by formulas and simulation. It combines:

- active runtime state
- team sourced effects
- selected target routing
- enemy state
- derived stat and effect maps

## Formulas

Primary directories:

- [src/engine/formulas](../src/engine/formulas)
- [src/engine/effects](../src/engine/effects)
- [src/engine/resolvers](../src/engine/resolvers)

Core formula responsibilities include:

- final stat aggregation
- direct damage resolution
- tune rupture
- negative effect handling
- scoped modifier application

The effect layer determines which modifiers exist while the formula layer determines how those modifiers are numerically applied.

## Skill And Row Preparation

Primary files:

- [src/engine/pipeline/prepareRuntimeSkill.ts](../src/engine/pipeline/prepareRuntimeSkill.ts)
- [src/engine/pipeline/resolveSkill.ts](../src/engine/pipeline/resolveSkill.ts)

Skill preparation transforms registry backed feature definitions and runtime state into resolved rows that the UI and rotation summaries can consume.

## Rotation Execution

Primary files:

- [src/engine/rotation/execute.ts](../src/engine/rotation/execute.ts)
- [src/engine/pipeline/simulateRotation.ts](../src/engine/pipeline/simulateRotation.ts)

Rotation execution uses the same combat context and skill resolution system as other Simulation calculations.

Important outputs:

- personal rotation totals
- team rotation totals
- node level inspection entries
- breakdown rows used by UI surfaces

## Negative Effects And Specialized Systems

Primary files:

- [src/engine/gameData/negativeEffects.ts](../src/engine/gameData/negativeEffects.ts)
- [src/engine/formulas/negativeEffects.ts](../src/engine/formulas/negativeEffects.ts)

## Related Docs

- [architecture.md](./architecture.md)
- [state-and-persistence.md](./state-and-persistence.md)
- [optimizer-and-suggestions.md](./optimizer-and-suggestions.md)
