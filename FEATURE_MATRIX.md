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
  - `W` / `A` / `S` / `D` and arrow keys
  - `F` refuel near furnace output (consumes one `iron-plate`)
- HUD runtime metrics:
  - Player position + fuel/max fuel
  - Entity composition counts (`miner/belt/inserter/furnace`)
  - Item transit counters (`iron-ore` / `iron-plate`)
  - Furnace craft/ready counters
- SVG rendering mode:
  - In-app toggle button (`SVGs Enabled/Disabled`)
- Transport behavior:
  - Belt/inserter/furnace throughput with deterministic cadence windows
  - Canonical contention handling covered in pipeline regression tests

## Programmatic Testability (Implemented)
- Type safety gate: `npm run typecheck`
- Build gate: `npm run build`
- Maintenance/local regression gate: `npm run test`
- Movement-focused deterministic regression gate: `npm run test:movement`
- Optional movement smoke E2E gate: `npm run test:movement:e2e`
- Strict verification mode: `npm run test:strict`

## Not Implemented / Missing
- Machine fuel and burner-power gameplay loops
- Power network and power consumers/producers
- Splitters and advanced logistics components
- Player inventory/crafting UI
- Save/load game state

## Notes
- Current tests intentionally lock deterministic behavior for the implemented vertical slice.
- Deferred systems above are intentionally out of scope for this slice and must not be used as QA failure criteria.
- Future gameplay additions should always ship with matching regression tests in `tests/sim*.test.ts`, `tests/pipeline.test.ts`, and targeted `tests/e2e/*.spec.ts`.
