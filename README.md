# Agents Ultra

Factorio-style agent playground focused on a playable vertical slice.

## Vertical Slice Overview
This slice is centered on core placement interactions in a browser sandbox:
- Select a build item from slots `1` to `5`
- Rotate placement direction before placing
- Place and remove structures on the grid
- Pause and resume the simulation loop
- Move the player avatar with `W` / `A` / `S` / `D` (or arrow keys)
- Refuel with `F` near furnace output using smelted iron-plate
- Track furnace/resource flow via live HUD metrics

The current slice is intentionally limited and does not yet include full logistics/economy systems.
For a full implemented-vs-missing snapshot, see `FEATURE_MATRIX.md`.

## Prerequisites
- Node.js `20+`
- npm (bundled with Node.js)

## Setup
```bash
npm install
```

## Run (Development)
```bash
npm run dev
```
Then open: `http://localhost:5173`

## Build
```bash
npm run build
```

## Test and Typecheck
```bash
npm run test
npm run typecheck
```
Use this mode for maintenance and local development. It keeps contributor loops moving by relying on skip behavior when optional test tooling is unavailable.

## Manual validation notes
- Fixed-step behavior: the simulation must run at deterministic 60 TPS using fixed-step progression, independent of render frame timing.
- Pause/resume expectation: pressing `Space` must freeze simulation state while paused and resume from the same state without losing or re-running ticks.

## Movement Regression Verification

Use this focused checklist before merging movement-related changes.

### Movement invariants
- No same-tick ingress + egress: a belt tile that receives from its source on a boundary tick must not forward to the next tile in the same tick.
- Cadence boundaries only: miner, belt, inserter, and furnace movement only changes on their configured cadence ticks (e.g., 60/20/15/180 style progression), with no off-by-one drift.
- Pause freeze: paused simulation must not advance tick, elapsed time, or world state; resume must continue from the exact prior phase.

### Fast local verification targets
1. `npm run typecheck`
2. `npx vitest run tests/sim-compat.test.ts tests/pipeline.test.ts`
3. `npx vitest run tests/sim-compat.test.ts -t "does not let a belt receive and forward on the same 15-tick boundary in single-hop chains"`
4. `npx vitest run tests/sim-compat.test.ts -t "enforces exact miner->belt->inserter->furnace progression at 60/20/15/180 boundaries"`
5. `npx vitest run tests/pipeline.test.ts -t "advances at most one belt tile per 15-tick cadence window"`
6. `npx vitest run tests/pipeline.test.ts -t "halts transport movement while paused and resumes from the exact prior cadence phase"`

## Optional E2E (Playwright)
```bash
npm i -D @playwright/test
npx playwright install --with-deps
npm run test:e2e
```

Notes:
- `npm run test:e2e` skips automatically when Playwright is not installed.
- E2E suite uses a Vite dev server on `http://127.0.0.1:4173`.

### Split test modes

- `npm run test` (maintenance/local): run fast checks locally before/while editing.
- `npm run test:strict` (CI/verification): run repository hygiene checks first, then strict unit and e2e tests.

### Movement Regression Gate (Local Pre-Merge)

```bash
npm run test:movement
```

Purpose: this is the dedicated deterministic transport/simulation regression gate. It catches cadence drift, pause/resume phase loss, and other deterministic movement failures before they reach `main`.

Run it locally from the repository root:
1. `npm install` (first run only, or after dependency updates)
2. `npm run test:movement`

When to run it:
- Before merge for any movement, cadence, pause/resume, transport, or simulation-loop change.
- As routine local hygiene before pushing gameplay logic changes.

This gate runs the movement-focused regression subset (`map/sim/sim-compat` unit coverage plus movement smoke E2E).

Expected behavior when dev dependencies are missing:
- `npm run test`: skips missing optional test suites and exits successfully.
- `npm run test:strict`: runs `npm run verify:hygiene` first (which fails fast on typecheck/build issues), then executes strict tests. In strict mode it exits non-zero with install guidance when required test binaries are absent.

### Strict verification sequence

`npm run test:strict` now runs:

```bash
npm run verify:hygiene
npm run test:unit -- --strict
npm run test:e2e:strict
```

This ordering fails fast so hygiene violations are reported before any strict test execution.

## Maintenance Sweep
Run this quick regression loop before/after gameplay changes:
```bash
npm run typecheck
npm run build
npm run test
```

## Controls
- `1` / `2` / `3` / `4` / `5`: select build slot (including Chest on `5`)
- `R`: rotate selected building orientation
- `W` / `A` / `S` / `D` or arrow keys: move player avatar
- `F`: refuel from nearby furnace output (consumes one iron-plate)
- `LMB` (left mouse button): place
- `RMB` (right mouse button): remove
- `Space`: pause/resume

## Quickstart: From Ore to Plate

1. Press 1 to select the Miner. Find an iron-ore patch and hover a tile that contains ore; press R to face the output where you want the belt, then LMB to place.
2. Press 2 to select Belt. Starting from the miner’s output tile, place belts (LMB) in the direction ore should travel; use R to set belt direction as you build.
3. Press 4 to select Furnace. Place it at the end of the belt path where an inserter can drop items into it; LMB to place.
4. Press 3 to select Inserter. Rotate with R so the pickup side faces the belt and the drop side faces the furnace, then LMB to place between them.
5. Press Space to unpause. The miner emits iron-ore, the belt advances it, the inserter feeds the furnace, and the furnace smelts iron-plate.
6. Use RMB to remove any misplaced entity. Re-select (1–5), rotate with R, and place again with LMB.
7. Watch for your first iron-plate after ~3 seconds of furnace time.

### Troubleshooting
- Miner won’t place or won’t mine: it must be placed directly on an iron-ore tile.
- Nothing moves on belts: ensure each belt segment faces the correct direction (use R). Belts should point from the miner toward the inserter/furnace.
- Inserter not transferring: rotate so pickup is on the belt and drop is on the furnace. Inserters stall if pickup is empty or the drop target is full/invalid.
- Output blocked: if the tile in front of the miner is occupied or the belt is full, the miner stalls. Clear with RMB or extend the belt.
- Still nothing? Check that the game isn’t paused (Space).

## What is implemented vs pending

- Implemented: miner, belt, inserter, furnace, chest, fixed-step simulation, deterministic transport loops, player movement/refuel, HUD metrics, SVG rendering, and chest inventory transfer (`Q`/`E`).
- In progress / pending: actual burner fuel/item economics (coal path), splitters, power system, save/load state, and broader crafting/optimization tooling.

## Known Limitations
- No power system yet
- No splitters yet
- Fuel loop is intentionally lightweight and currently uses furnace output plates for player refuel (no burner network yet)

## Troubleshooting
- `npm: command not found`: reinstall Node.js `20+` and confirm with `node -v` and `npm -v`.
- Port `5173` already in use: stop the conflicting process or run with a different Vite port.
- Right-click does not remove: ensure the browser is focused on the game canvas (some browser/OS context menu behaviors can interfere).
