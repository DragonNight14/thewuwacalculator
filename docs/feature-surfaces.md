# Features And Pages

## Home

Primary root: [src/modules/home](../src/modules/home)

## Simulation

Primary root: [src/modules/simulation](../src/modules/simulation)

Simulation code is grouped by purpose:

- `shell`: the route boundary, Simulation-wide providers, imports, and context menus
- `workspace`: the persistent roster, rail, loadout, and shared board
- `features`: reusable resonator, weapon, Echo, team, enemy, buff, inventory, and result capabilities
- `surfaces`: route-selectable Modulation, Rotation, Showcase, Optimizer, and Suggestions
- `model` and `ui`: Simulation presentation logic and primitives
- `api`: explicit contracts used by app routing or another feature module

### Modulation

Primary root: [src/modules/simulation/surfaces/modulation](../src/modules/simulation/surfaces/modulation)

Modulation combines character progression, weapon and Echo loadout, active states, team context, live stats, damage, and build evaluation. The evaluation engine produces baseline, active, reference, and maximum builds.

### Rotation

Primary root: [src/modules/simulation/surfaces/rotation](../src/modules/simulation/surfaces/rotation)

Rotation builds, simulates, saves, imports, and shares ordered team actions. Its editor uses the combat scenario and simulation state.

### Showcase

Primary root: [src/modules/simulation/surfaces/showcase](../src/modules/simulation/surfaces/showcase)

UI for customizable build export card. Its visual preferences are stored as `showcaseCards`.

### Optimizer

Primary root: [src/modules/simulation/surfaces/optimizer](../src/modules/simulation/surfaces/optimizer)

Searches inventory and theoretical Echo combinations against a selected skill or rotation target.

### Suggestions

Primary root: [src/modules/simulation/surfaces/suggestions](../src/modules/simulation/surfaces/suggestions)

Ranks main stat layouts, sonata set plans, and weapons against a selected skill or rotation target.

### Shared Workspace And Inventory

Primary roots:

- [src/modules/simulation/workspace](../src/modules/simulation/workspace)
- [src/modules/simulation/features/inventory](../src/modules/simulation/features/inventory)
- [src/modules/simulation/features/echoes](../src/modules/simulation/features/echoes)

## Read

Primary root: [src/modules/read](../src/modules/read)

Guides, Docs, Changelog, Privacy, Terms, etc. Home has a What's New section organized by release. Authored content is in `src/data/content`.

## Calibration And System

- [src/modules/calibration](../src/modules/calibration): appearance, application preferences, exports and data management.
- [src/modules/system](../src/modules/system): fallback system pages such as Not Found.

## Related Docs

- [app-shell-and-routing.md](./app-shell-and-routing.md)
- [state-and-persistence.md](./state-and-persistence.md)
- [optimizer-and-suggestions.md](./optimizer-and-suggestions.md)
