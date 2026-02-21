# SPEC

## Overview
This document defines the first playable vertical slice of a browser-based factory simulation.

The goal is a deterministic, grid-based simulation where the player can place and remove core entities and observe a complete material flow:
`iron-ore` extraction -> transport -> insertion -> smelting into `iron-plate`.

The slice is intentionally narrow. It must prioritize a stable simulation loop, clear entity contracts, and reliable player input over content breadth.

## Stack
- Runtime: Node.js 20+
- Build/dev server: Vite 6
- Language: TypeScript with `strict` mode enabled
- UI framework: React 18
- Testing: Vitest

### Rendering
- Primary implementation for this slice: HTML5 Canvas2D via `<canvas>` rendering context.
- PixiJS 8 is an acceptable future alternative; it is not the required renderer for this slice.

## Project Structure
All implementation for this slice must fit this structure:

```text
src/
  core/
    types/       # shared enums, interfaces, simulation contracts
    sim/         # tick loop, world update orchestration, deterministic stepping
    map/         # tile/grid state, occupancy, placement/removal helpers
  entities/
    resource/    # iron-ore resource node behavior
    miner/
    belt/
    inserter/
    furnace/
    chest/       # optional in this slice; can exist as stub or disabled entity
  ui/
    renderer/    # Canvas2D rendering, scene abstraction, and layer/camera coordination
    input/       # keyboard/mouse bindings and action dispatch
    components/  # React UI controls and HUD
tests/
  unit/          # Vitest unit tests for core systems and entity behavior
```

Rules:
- Simulation logic must remain in `src/core` and `src/entities`; UI files must not contain game-rule logic.
- Entity behavior must be encapsulated in `src/entities/*` modules and invoked from the core simulation step.
- `tests/unit` must cover deterministic logic; rendering can be lightly tested or mocked.

## Simulation
- Tick rate: fixed `60 TPS` (1 tick = `16.666... ms` simulation time).
- Update model: fixed-step simulation; rendering may run at display refresh rate but must consume the latest committed sim state.
- SIM→Renderer contract:
  - Simulation publishes rendering input through the snapshot adapter in `src/core/snapshot.ts`.
  - Renderer must consume snapshots on the tick boundary and render from those immutable state snapshots rather than sim internals.
- World grid:
  - Tile size: `32px x 32px`.
  - Positioning: entities occupy integer tile coordinates.
  - Placement/removal and movement logic operate in tile space, not pixel space.
- Directions:
  - Allowed set: `N`, `E`, `S`, `W`.
  - Rotation order on `R`: `N -> E -> S -> W -> N`.
  - Direction affects output/input sides for directional entities (Miner, Belt, Inserter, Furnace IO if directional).
- Determinism:
  - Given identical initial state and input sequence, state progression must be identical across runs.

## Entities
This vertical slice supports the following entity kinds and minimal behavior:

1. Resource (`iron-ore`)
- Static map entity/resource node.
- Holds infinite extractable ore for the vertical slice.
- Does not move items itself.

2. Miner
- Placeable, directional machine.
- Placement rule: must be placed on a tile containing a Resource node.
- Extracts `iron-ore` from the underlying resource tile.
- Cycle time: emits one `iron-ore` every `60` ticks (1 second) toward the tile in its facing direction, if output accepts input.

3. Belt
- Placeable, directional transport.
- Accepts incoming `iron-ore` and `iron-plate` items subject to capacity constraints.
- Capacity: one item per belt tile for this slice.
- Moves the current item one tile forward every `15` ticks if the target accepts the transfer.

4. Inserter
- Placeable, directional transfer arm.
- Pulls items from its pickup side and deposits to its drop side.
- Supports `iron-ore` and `iron-plate` transfer in this slice.
- Cycle time: one transfer attempt every `20` ticks.

5. Furnace
- Placeable processing machine.
- Input: `iron-ore`.
- Output: `iron-plate`.
- Smelt time: `180` ticks (3 seconds) per plate.
- No fuel or power consumption in this slice.

6. Chest (optional)
- Optional storage entity for buffering items.
- If included, it can store both item types with a bounded or documented capacity.
- If omitted from implementation, core architecture must still allow adding it without refactoring simulation ownership.

Item scope for this slice is exactly:
- `iron-ore`
- `iron-plate`

## Controls
Keyboard/mouse controls are fixed for the slice:

- `1` Select Miner placement tool
- `2` Select Belt placement tool
- `3` Select Inserter placement tool
- `4` Select Furnace placement tool
- `R` Rotate currently selected placement direction
- `Left-click` Place selected entity at target tile (if valid)
- `Right-click` Remove entity at target tile (if removable)
- `Space` Pause/resume simulation stepping

Notes:
- Resource nodes are not user-placeable in this slice unless explicitly added later.
- Resource nodes are not removable via right-click.
- Chest is optional and not bound to `1-4` in this scope.

## Deferred Items
The following are intentionally out of scope and must not be required for "done" in this slice:

- Power generation/distribution systems
- Fuel mechanics for furnaces or miners
- Belt splitters
- Belt mergers/prioritizers

These can be layered later without breaking core contracts from this spec. Their absence must not be treated as a QA regression for this vertical slice.

## Testing
Testing is required with Vitest and should focus on deterministic simulation behavior.

Validation command contract for this repository:
- `npm run dev` for local Vite 6 development server.
- `npm run build` for typecheck + production build validation.
- `npm run test` for maintenance/local regression checks (skip-aware wrappers).
- `npm run test:movement` for deterministic movement regression gating.
- `npm run test:strict` for CI-style strict verification.

Minimum expected unit-test coverage areas:
- Tick stepping: fixed 60 TPS progression and pause/resume behavior.
- Grid placement/removal validation for occupied/unoccupied tiles.
- Directional behavior and rotation mapping (`N/E/S/W`).
- Miner extraction of `iron-ore`.
- Belt transfer forward by direction.
- Inserter pickup/drop transfer path.
- Furnace conversion from `iron-ore` to `iron-plate` after processing ticks.

Manual validation focus:
- Fixed-step behavior: simulation state advancement must be deterministic at 60 TPS and independent of render timing.
- Pause/resume behavior: `Space` pauses sim progression with no state changes and resumes from the exact prior tick state.

Renderer/UI tests can be shallow and focus on integration boundaries (e.g., input action dispatch), while simulation correctness remains unit-tested in `tests/unit`.
