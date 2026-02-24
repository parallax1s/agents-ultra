# Agents Ultra Feature Matrix

Last updated: 2026-02-22

## Current Scope Summary
 - Total listed feature areas: 17
 - Implemented: 17
 - In progress: 0
 - Not started: 0

## Implemented

1. **Tile map + resource generation**
   - Resource patch generation (iron-ore and coal-ore) with deterministic seeds.
   - 10x10 no-resource spawn ring.

2. **Miner extraction loop**
   - Directional miner placement, cadence, and ore emission.

3. **Belt transport**
   - Directional transport, deterministic fixed-step cadence, occupancy checks.

4. **Inserter transfer**
   - Directional pickup/drop, deterministic cadence, ore + plate support.

5. **Furnace processing**
   - Iron-ore -> iron-plate conversion over fixed ticks.

6. **Player controls and simulation loop**
   - WASD movement, pause/resume, ghost placement, rotations, and fixed-step tick progression.

7. **Refuel action**
   - `F` near furnace output to consume one smelted plate.

8. **Chest entity + local inventory I/O**
   - Optional chest storage with `Q`/`E` player pickup/deposit flow.

9. **HUD + rendering pipeline**
   - Canvas renderer with entity sprites, player fuel bar, in-world interaction hints, and metrics panel.

10. **Coal + coal fuel loop**
    - Coal patch generation, miner extraction to coal, and furnace fuel requirements.

11. **Feature status dashboard accuracy pass**
   - Aligning docs, runtime behavior, feature tracker, and roadmap visibility.

12. **Persistence + save/load state**
   - Persist complete simulation state, player stats, and inventory to localStorage and restore deterministically.

13. **Splitters / mergers / stack-balancing conveyors**
    - Splitter routing and deterministic branch arbitration for transport branches.

14. **Broader crafting/assembly content**
   - Gear recipes, assembler machine placement, and recipe-chain extension from plate -> gear.

15. **Power systems and energy budgets**
   - Global power storage, per-tick demand/consumption accounting, and entity-level power costs.
   - Producer network graph, connected/disconnected consumer behavior, and power diagnostics.
   - Furnace start/run power hooks with power generation from consumed coal.

16. **Agent workflow tooling integration**
   - Added local agent smoke workflow that runs typecheck/build, movement regression, and optional/strict e2e checks.
   - Introduced `agent:workflow`, `agent:workflow:strict`, and `agent:smoke:strict` npm scripts.

17. **Keyboard shortcut accessibility overlay**
  - Added compact touch/keyboard hint overlay with explicit toggle (`K`) and control button.
  - Added quick-action controls (pause, single/ten-step tick advance, clear tool, auto-follow, camera focus, SVG toggle) directly in the overlay.
  - Added overlay backdrop interaction to close on outside click plus regression coverage in the Playwright smoke suite for actions.

## In Progress

No in-progress features.

## Not Started (Planned)
None.

## Status Interpretation (for coordination)
- "Implemented" means the behavior is present and reasonably stable in current UI and simulation code.
- "In progress" means code is currently being iterated and may change before the next checkpoint.
- "Not started" means deferred by scope and ready for next roadmap stage.

## Programmatic Testability
- Type safety gate: `npm run typecheck`
- Build gate: `npm run build`
- Maintenance/local regression gate: `npm run test`
- Movement-focused deterministic regression gate: `npm run test:movement`
- Optional movement smoke E2E gate: `npm run test:movement:e2e`
- Strict verification mode: `npm run test:strict`

## Notes
- Current tests intentionally lock deterministic behavior for the implemented vertical slice.
- Deferred systems are intentionally out of scope for this slice and must not be used as QA failure criteria.
- Future gameplay additions should always ship with matching regression tests in `tests/sim*.test.ts`, `tests/pipeline.test.ts`, and targeted `tests/e2e/*.spec.ts`.
