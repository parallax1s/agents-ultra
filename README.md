# Agents Ultra

Factorio-style agent playground focused on a playable vertical slice.

## Vertical Slice Overview
This slice is centered on core placement interactions in a browser sandbox:
- Select a build item from slots `1` to `8`
- Rotate placement direction before placing
- Place and remove structures on the grid
- Pause and resume the simulation loop
- Move the player avatar with `W` / `A` / `S` / `D` (or arrow keys)
- Refuel with `F` near furnace output using smelted output
- Track furnace/resource flow via live HUD metrics

The current slice is intentionally limited and does not yet include full logistics/economy systems.
For a full implemented-vs-missing snapshot, see `FEATURE_MATRIX.md`.

## Prerequisites
- Node.js `20+`
- Vite `6` (via project devDependency)
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
2. `npm run test:movement:regression`
3. `npm run test:movement:regression -- tests/sim-compat.test.ts -t "does not let a belt receive and forward on the same 15-tick boundary in single-hop chains"`
4. `npm run test:movement:regression -- tests/sim-compat.test.ts -t "enforces exact miner->belt->inserter->furnace progression at 60/20/15/180 boundaries"`
5. `npm run test:movement:regression -- tests/pipeline.test.ts -t "advances at most one belt tile per 15-tick cadence window"`
6. `npm run test:movement:regression -- tests/pipeline.test.ts -t "halts transport movement while paused and resumes from the exact prior cadence phase"`

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
- `npm run agent:workflow` (agent parity/local): typecheck + build + movement regression + optional e2e smoke.
- `npm run agent:smoke:strict` (strict): run the same checks but fail if tooling is missing.
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

This gate runs the movement-focused deterministic unit/integration regression subset. For browser smoke coverage, run `npm run test:movement:e2e` separately.

Expected behavior when dev dependencies are missing:
- `npm run test`: skips missing optional test suites and exits successfully.
- `npm run test:strict`: runs `npm run verify:hygiene` first (which fails fast on typecheck/build issues), then executes strict tests. In strict mode it exits non-zero with install guidance when required test binaries are absent.
- `npm run agent:workflow -- --strict`: run the full agent parity workflow in strict mode.

### Agent workflow smoke (one command)

Use this before and after gameplay logic edits to keep local behavior aligned with automated checks:

```bash
npm run agent:workflow
```

This runs:

1. `npm run typecheck`
2. `npm run build`
3. `npm run test:movement:regression`
4. `npm run test:e2e` (skip mode by default when Playwright is missing)

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
npm run agent:workflow -- --strict
```

## Controls
- `1` / `2` / `3` / `4` / `5` / `6` / `7` / `8`: select build slot (`Splitter` on `3`, `Chest` on `6`, `Assembler` on `7`, `SolarPanel` on `8`)
- `[`, `]`: cycle build slot backward/forward
- `R`: rotate selected building orientation
- `Mouse wheel`: cycle build slot while pointer is over canvas
- `H`: toggle HUD visibility
- `Escape`: clear selected tool
- `W` / `A` / `S` / `D` or arrow keys: move player avatar
- `F`: refuel from nearby furnace output (consumes one output unit)
- `Q` / `E`: pickup / deposit against adjacent chest-like entity inventories
- `LMB` (left mouse button): place
- `RMB` (right mouse button): remove
- `Space` / `P`: pause/resume
- `.` / `/`: step simulation one tick when running or paused
- `Shift+.` / `Shift+/`: step simulation 10 ticks when running or paused
- `Ctrl+S`: save state
- `Ctrl+L`: load state
- `Ctrl+X` / `Delete` / `Backspace`: clear saved state
- `Ctrl+R`: reset runtime state
- Top-right HUD buttons: `Save State`, `Load State`, `Clear Save`, `Toggle Pause`, `Step Tick`, `Step 10 Ticks`, `Reset`

## Quickstart: From Ore to Plate

1. Press 1 to select the Miner. Find an iron-ore or coal-ore patch and hover a tile that contains ore; press R to face the output where you want the belt, then LMB to place.
2. Press 2 to select Belt. Starting from the miner’s output tile, place belts (LMB) in the direction ore should travel; use R to set belt direction as you build.
3. Press 3 to select Splitter. Place it after the belt and rotate so it points forward and splits into two lateral outputs.
4. Press 4 to select Inserter. Rotate with R so the pickup side faces the source lane and the drop side faces the furnace, then LMB to place.
5. Press 5 to select Furnace. Place it at the end of the belt path where an inserter can drop items into it.
6. Press 6 / 7 / 8 for Chest, Assembler, SolarPanel when needed.
7. Press Space to unpause. The miner emits iron-ore, the belt advances it, the inserter feeds the furnace, and the furnace smelts iron-plate.
8. Click entities to interact with their inventory-like behavior (for chests) and use Q/E for explicit player transfers.
9. Use RMB to remove any misplaced entity. Re-select (1–8), rotate with R, and place again with LMB.
7. Watch for your first iron-plate after ~3 seconds of furnace time.

### Troubleshooting
- Miner won’t place or won’t mine: it must be placed directly on an ore tile (iron-ore or coal-ore).
- Nothing moves on belts: ensure each belt segment faces the correct direction (use R). Belts should point from the miner toward the inserter/furnace.
- Inserter not transferring: rotate so pickup is on the belt and drop is on the furnace. Inserters stall if pickup is empty or the drop target is full/invalid.
- Output blocked: if the tile in front of the miner is occupied or the belt is full, the miner stalls. Clear with RMB or extend the belt.
- Still nothing? Check that the game isn’t paused (Space).

## What is implemented vs pending

- Implemented: miner, belt, splitter, inserter, furnace, chest, fixed-step simulation, deterministic transport loops, player movement/refuel, HUD metrics, SVG rendering, chest inventory transfer (`Q`/`E`), and save/load state persistence.
- Agent workflow tooling integration is implemented via the `agent:workflow*` scripts.

## End-goal spec (for agent swarm launches)

- Before running another Agent Swarm, use `ENDGOAL_SPEC.md` as the authoritative plan.
- `ENDGOAL_SPEC.md` contains Factorio-inspired feature mapping, architecture flow charts, and phase sequencing.
- The immediate launch checklist is the SPARK preflight in that document:
- Scope, Plan, Agenda, Reliability, and Kickoff evidence.
- Launch operations (agent assignment, card handoff, reliability gates) are defined in
  `AGENT_SWARM_LAUNCH_PLAN.md`.

## Roadmap and next features

- Current feature backlog is tracked in `FEATURE_ROADMAP.md`.
- Use this as the working checklist for the next iterations and mark items as in progress or complete as we ship them.

## Implementation planning source files

- `ENDGOAL_SPEC.md`: high-level target architecture and growth path.
- `FACTORIO_GAP_FEATURES.md`: concise Factorio-to-Agents Ultra gap matrix.
- `FEATURE_MATRIX.md`: current implementation matrix and quality signals.
- `FEATURES.json`: machine-readable status list used for automation and tracking.

## Known Limitations
- Power networking behavior and disconnected consumer diagnostics are implemented.
- Furnace fuel now requires coal input and continues to use furnace output as player refuel

## Troubleshooting
- `npm: command not found`: reinstall Node.js `20+` and confirm with `node -v` and `npm -v`.
- Port `5173` already in use: stop the conflicting process or run with a different Vite port.
- Right-click does not remove: ensure the browser is focused on the game canvas (some browser/OS context menu behaviors can interfere).
