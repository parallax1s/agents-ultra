# Agents Ultra

Factorio-style agent playground focused on a playable vertical slice.

## Vertical Slice Overview
This slice is centered on core placement interactions in a browser sandbox:
- Select a build item from slots `1` to `4`
- Rotate placement direction before placing
- Place and remove structures on the grid
- Pause and resume the simulation loop

The current slice is intentionally limited and does not yet include full logistics/economy systems.

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
- `1` / `2` / `3` / `4`: select build slot
- `R`: rotate selected building orientation
- `LMB` (left mouse button): place
- `RMB` (right mouse button): remove
- `Space`: pause/resume

## Quickstart: From Ore to Plate

1. Press 1 to select the Miner. Find an iron-ore patch and hover a tile that contains ore; press R to face the output where you want the belt, then LMB to place.
2. Press 2 to select Belt. Starting from the miner’s output tile, place belts (LMB) in the direction ore should travel; use R to set belt direction as you build.
3. Press 4 to select Furnace. Place it at the end of the belt path where an inserter can drop items into it; LMB to place.
4. Press 3 to select Inserter. Rotate with R so the pickup side faces the belt and the drop side faces the furnace, then LMB to place between them.
5. Press Space to unpause. The miner emits iron-ore, the belt advances it, the inserter feeds the furnace, and the furnace smelts iron-plate.
6. Use RMB to remove any misplaced entity. Re-select (1–4), rotate with R, and place again with LMB.
7. Watch for your first iron-plate after ~3 seconds of furnace time.

### Troubleshooting
- Miner won’t place or won’t mine: it must be placed directly on an iron-ore tile.
- Nothing moves on belts: ensure each belt segment faces the correct direction (use R). Belts should point from the miner toward the inserter/furnace.
- Inserter not transferring: rotate so pickup is on the belt and drop is on the furnace. Inserters stall if pickup is empty or the drop target is full/invalid.
- Output blocked: if the tile in front of the miner is occupied or the belt is full, the miner stalls. Clear with RMB or extend the belt.
- Still nothing? Check that the game isn’t paused (Space).

## Known Limitations
- No power system yet
- No splitters yet

## Troubleshooting
- `npm: command not found`: reinstall Node.js `20+` and confirm with `node -v` and `npm -v`.
- Port `5173` already in use: stop the conflicting process or run with a different Vite port.
- Right-click does not remove: ensure the browser is focused on the game canvas (some browser/OS context menu behaviors can interfere).
