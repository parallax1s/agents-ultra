# Agents Ultra Feature Matrix

Last updated: 2026-02-22

## Current Scope Summary
- Total listed feature areas: 14
- Implemented: 9
- In progress: 1
- Not started: 4

## Implemented

1. **Tile map + resource generation**
   - Iron-ore patch generation with deterministic seeds.
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

## In Progress

1. **Feature status dashboard accuracy pass**
   - Consolidating one source-of-truth feature tracker with explicit counts and ownership.
   - Goal: align docs, runtime behavior, and roadmap visibility.

## Not Started (Planned)

1. **Coal and coal fuel loop**
   - Coal patch generation, burner-type fuel semantics, and player/furnace burner integrations.

2. **Splitters / mergers / stack-balancing conveyors**
   - Branching and routing logic for non-linear transport topologies.

3. **Power systems and energy budgets**
   - Power generation + consumption model before expansion.

4. **Persistence + save/load state**
   - Rehydrate run state and continue mid-build.

5. **Broader crafting/assembly content**
   - Extended recipes and machine chain beyond ore->plate baseline.

6. **Agent workflow tooling integration**
   - Keep gameplay parity with automated agents running local smoke tests for gameplay changes.

## Status Interpretation (for coordination)
- "Implemented" means the behavior is present and reasonably stable in current UI and simulation code.
- "In progress" means code is currently being iterated and may change before the next checkpoint.
- "Not started" means deferred by scope and ready for next roadmap stage.

## Direct Answer to Current Gameplay Questions
- **Current refuel behavior**: `F` still refuels from nearby furnace output, consuming **iron-plate**, not coal.
- **Coal availability**: Coal is not currently in the active loop. Ore-only is the active resource for now (`iron-ore`).
