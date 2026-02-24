# Factorio Feature Translation for Agents Ultra

Last reviewed: 2026-02-23

This document is the direct “what Factorio does → what Agents Ultra currently has → what to build next” mapping.

## 1) Trees and resource extraction check

- ✅ Trees are already implemented as mineable resources:
  - Player mine: adjacent tree → `wood`.
  - Miner placement: still requires ore/coal tile and supports finite depletion.
  - Rendering and metrics already account for `tree`, `wood`, and tree depletion states.

## 2) Factorio core systems vs Agents Ultra map

Legend:
- ✅ Implemented
- 🟡 In progress
- ⬜ Planned

### Resources and terrain
- ✅ Finite tile-based resource fields (`iron-ore`, `coal-ore`, `tree`).
- ✅ Deterministic map generation and spawn exclusion ring.
- ✅ Player-adjacent manual mining for ore/coal/trees.
- ✅ Finite ore/coal/wood depletion path and remaining counts in metrics.
- 🟡 Resource interaction UX (tutorial emphasis + clearer interaction states).
- ⬜ Water/oil/fluids and pollution biomes.
- ⬜ Advanced biome generation, patches, and richness scaling.
- ⬜ Infinite resource/terrain transformation systems.

### Player and movement
- ✅ WASD / arrows movement with collision checks.
- ✅ Pause/start simulation and deterministic tick stepping.
- ✅ Tool selection/placement/removal workflows.
- ✅ Inventory with limited capacity and fuel consumption.
- ⬜ Encumbrance/slowdown and character crafting interface.
- ⬜ Player combat/basic tools (axe/pistol/repeat actions).
- 🟡 Optional interaction mode polish (hand/focus/hud context).

### Production and processing
- ✅ Miner machines and directional output loops.
- ✅ Belt transport and splitter balancing.
- ✅ Inserters with pickup/drop semantics.
- ✅ Furnace and assembly machine chains (ore → plate → gear).
- ✅ Manual and automatic chest workflows.
- 🟡 Mission/task onboarding for first production flow.
- ⬜ Recipe graph with multiple inputs/outputs.
- ⬜ Unlock gating and recipe availability rules.
- ⬜ Throughput optimization via module-like upgrades.
- ⬜ Advanced machine inventory handling.

### Power and energy
- ✅ Solar panels and accumulators.
- ✅ Runtime power graph (`demand`, `supply`, `shortage`) and consumer diagnostics.
- ✅ Player fuel loop (coal/wood).
- 🟡 Clearer per-building power status in runtime UI.
- ⬜ Boiler/steam/turbine and power-density balancing.
- ⬜ Networked power poles and transmission capacity.
- ⬜ Burners and alternative fuels.

### Logistics and automation
- ✅ Chests, adjacency interaction, Q/E pickup/deposit.
- ✅ Keyboard/touch action overlays and tool touch controls.
- ✅ Blueprint import/export, runtime plan execution, runtime copy/paste.
- ✅ Undo/redo history and checkpoints.
- 🟡 Better conveyor lane visibility/performance hints.
- ⬜ Underground belts and lane filtering.
- ⬜ Logistic robots + roboports + charging behavior.
- ⬜ Train stack/inserter equivalents.

### Control systems and UX
- ✅ Runtime plan system + auto agents (refuel/pickup/deposit).
- ✅ Save/load persistence and migration compatibility summaries.
- ✅ HUD, minimap, quick overlay, touch panel, and reduced-motion mode.
- ✅ Tutorial mode toggle with mission completion tracking.
- 🟡 Guided progression with objective tree and context help.
- ⬜ Accessibility-first keyboard-first navigation.
- ⬜ Production analytics dashboards and bottleneck explanation.

### Combat and environment (future)
- ⬜ Enemy spawner ecology and threats.
- ⬜ Pollution damage and cleanup loops.
- ⬜ Pollution-aware terrain behavior and expansion pressure.
- ⬜ Radar/ranged visibility systems.

## 3) Proposed implementation roadmap (translation priorities)

Priority 1 (high ROI for current slice):
1. **Tree + finite resource UX consolidation**
   - Keep trees in the onboarding loop explicit.
   - Add clearer mission text and mission-end criteria around wood usage and depletion.

2. **Conveyor lane control**
   - Belt side priorities / basic filtered handoff.
   - Reduces deadlocks and gives direct player agency over routing quality.

3. **Research/progression shell**
   - Add a minimal tech gate system for recipes and entity unlocks.
   - Keeps your current simulation while adding longer-term retention.

Priority 2:
4. **Underground logistics**
   - Introduce buried belt behavior and crossing constraints.

5. **Fluid extraction starter**
   - Add a light oil chain that mirrors miner→processing→storage flow.

6. **Expanded combat loop**
   - Add a small threat model (enemy pressure, response behavior) to increase factory protection pressure.

## 4) Translation status note

- You already have the hard baseline for mines, belts, furnaces, assembly, power, plans, save/load, and trees.
- The biggest leverage improvements are no longer core simulation correctness, but **UX clarity + routing and progression systems**.
- The next feature batch should prioritize player confidence (clear actions, intentional routing, mission-driven learning) before adding all full Factorio systems at once.
