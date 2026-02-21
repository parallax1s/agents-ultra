# Agents Ultra Feature Matrix

Status snapshot: `a0176a8`

## Implemented
- Grid-based build sandbox with 4 placeable entities:
  - Miner
  - Belt
  - Inserter
  - Furnace
- Placement/removal loop:
  - Select slots `1`-`4`
  - Rotate with `R`
  - Place with left-click
  - Remove with right-click
- Simulation loop:
  - Fixed-step tick cadence (`60 TPS`)
  - Pause/resume via `Space`
  - Deterministic tick-phase ordering (`miner -> belt -> furnace -> inserter`)
- Player marker controls:
  - `W` / `A` / `S` / `D`
- SVG rendering mode:
  - In-app toggle button (`SVGs Enabled/Disabled`)
- Transport behavior:
  - Belt/inserter/furnace throughput with deterministic cadence windows
  - Canonical contention handling covered in pipeline regression tests

## Programmatic Testability (Implemented)
- Unit + integration tests with `vitest`
- Browser flow smoke tests with `playwright`
- Type safety gate with `tsc --noEmit`
- Movement-focused regression gate:
  - `npm run test:movement:regression`
  - `npm run test:movement:e2e` (strict mode available)
- Strict verification mode:
  - `npm run test:strict`

## Not Implemented / Missing
- Refuel interaction (`F`) is not implemented in this codebase
- Fuel system / burner gameplay loop
- Power network and power consumers/producers
- Splitters and advanced logistics components
- Player inventory/crafting UI
- Save/load game state

## Notes
- Current tests intentionally lock deterministic behavior for the implemented vertical slice.
- Future gameplay additions should always ship with matching regression tests in `tests/sim*.test.ts`, `tests/pipeline.test.ts`, and targeted `tests/e2e/*.spec.ts`.
