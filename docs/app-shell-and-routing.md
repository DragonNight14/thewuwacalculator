# App Shell And Routing

## Bootstrap

Primary files:

- [src/main.tsx](../src/main.tsx)
- [src/app/AppRoot.tsx](../src/app/AppRoot.tsx)
- [src/app/providers/AppProviders.tsx](../src/app/providers/AppProviders.tsx)

The route-appropriate core or scoped game data loads before React mounts. App-wide persistence, theme, wallpaper, font, tooltip, context-menu, and selection providers then wrap the router. Google OAuth is installed only around the Calibration page, where Drive backup controls use it.

## Public Routes

Primary files:

- [src/shared/lib/appRoutes.ts](../src/shared/lib/appRoutes.ts)
- [src/app/router/routeTable.tsx](../src/app/router/routeTable.tsx)
- [src/app/nav/routeChunks.ts](../src/app/nav/routeChunks.ts)

Home:

- `/`

Simulation tools:

- `/modulation`
- `/rotation`
- `/showcase`
- `/optimizer`
- `/suggestions`

Read pages:

- `/guides`
- `/docs`
- `/changelog`
- `/privacy`
- `/terms`

## Shared Simulation Workspace

[SimulationPage.tsx](../src/modules/simulation/shell/SimulationPage.tsx) initializes shared Simulation providers. Modulation, Showcase, Optimizer, and Suggestions use one persistent parameterized route and [BuildWorkspaceSurface.tsx](../src/modules/simulation/workspace/BuildWorkspaceSurface.tsx).

Route chunks preserve lazy loading and prewarm tool modules on navigation intent.

## Route Chrome

Primary files:

- [src/app/shell/AppLayout.tsx](../src/app/shell/AppLayout.tsx)
- [src/app/shell/ChromeHeader.tsx](../src/app/shell/ChromeHeader.tsx)
- [src/application/navigation/appIndex.ts](../src/application/navigation/appIndex.ts)

`AppLayout` provides the route layout, global overlays, route effects, roster display area, and page outlet. `ChromeHeader` renders the header.

## Related Docs

- [architecture.md](./architecture.md)
- [feature-surfaces.md](./feature-surfaces.md)
- [state-and-persistence.md](./state-and-persistence.md)
