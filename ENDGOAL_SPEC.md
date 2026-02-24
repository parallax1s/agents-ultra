# Agents Ultra End-Goal Spec: Factorio-Style Growth Blueprint

## 1) Purpose

Agents Ultra is no longer just a vertical slice; it is a persistent, deterministic automation game with a clear production and automation arc.  
This document is the "end-goal" contract used before each Agent Swarm launch.

Primary objective: move from “core extraction to plates” toward a stable factory loop that supports:

- scalable resource extraction,
- deterministic manufacturing chains,
- meaningful logistics and power planning,
- automation tooling,
- guided player progression,
- robust testability and operations.

This is deliberately ambitious but sequenced so each stage can be shipped and validated independently.

## 2) Flow charts that define the architecture

### 2.1 Primary throughput loop

```mermaid
flowchart LR
    O[iron-ore tile] --> M1[Miner]
    C[coal-ore tile] --> M2[Coal Miner]
    T[tree tile] --> P1[Player mining / future axe chain]

    M1 -->|ore items| B1[Belt Network]
    M2 -->|coal items| B2[Belt Network]
    P1 --> P2[Manual Wood Stock]

    B1 --> I1[Inserter]
    B2 --> I2[Inserter]
    I1 --> F[Furnace]
    I2 --> F2[Furnace]

    F -->|smelt ticks + power| IP[iron-plate]
    IP --> A[Assembler]
    A --> G[iron-gear]
    G --> E[Chests / Belts / Train-ready output]
```

### 2.2 Power flow architecture

```mermaid
flowchart LR
    P[Power Sources] --> S[Solar Panels / Boilers / generators]
    S --> A1[Accumulator Network]
    A1 --> D1[Consumers]
    D1 --> M3[Miner]
    D1 --> B3[Belt motors / transport]
    D1 --> I3[Inserter control]
    D1 --> F1[Furnace power demand]
    D1 --> A2[Assemblers and future machines]
    A1 -->|shortage| DIAG[Disconnected / starved diagnostics]
```

### 2.3 Player and automation control flow

```mermaid
flowchart TD
    INPUT[Input events\nkeyboard / mouse / touch / overlay] --> ROUTE{Route}
    ROUTE -->|Placement| PLACE[Placement, rotation, validity]
    ROUTE -->|Tool action| ACTION[Mine / interact / pickup / deposit]
    ROUTE -->|Simulation control| CTRL[Pause, step, speed, follow]
    ROUTE -->|Automation| AUTO[Agents: refuel, pickup, deposit]

    PLACE --> SIM[Validated simulation command]
    ACTION --> SIM
    CTRL --> SIM
    AUTO --> SIM
    SIM --> SNAP[Committed world snapshot]
    SNAP --> UI[HUD, minimap, tutorial, hints]
    SNAP --> E2E[Playwright / unit verification]
```

### 2.4 Content progression state (goal)

```mermaid
stateDiagram-v2
    [*] --> RawMaterial
    RawMaterial --> Smelting
    Smelting --> BasicAssembly
    BasicAssembly --> PoweredFactory
    PoweredFactory --> LogisticsExpansion
    LogisticsExpansion --> AutomationScale
    AutomationScale --> Mastery
    Mastery --> [*]
```

## 3) Factorio feature gap model

This is what “Factorio-like” means for Agents Ultra in practice.

### World and resources

- Implemented: finite ore (iron, coal), tree extraction, deterministic map generation.
- Missing / next: richer biome generation, oil/fluid nodes, finite depletion strategy, environmental progression and map editing tools.
- Target: retain determinism while adding controlled complexity via resource modifiers and density tuning.

### Production

- Implemented: miner, belt, splitter, inserter, furnace, chest, assembler, recipe chaining.
- Missing / next: multi-input recipes, recipe unlock progression, throughput balancing, production bottleneck analysis UI, and recipe filtering.
- Target: recipe system with discoverable unlocks and meaningful choices.

### Logistics

- Implemented: direct belt/splitter paths and basic chest movement.
- Missing / next: underground transport, filtered routing, lane priority controls, smart routing hints, and future robot logistics.
- Target: explicit routing tools that improve reliability without hand-holding.

### Energy

- Implemented: global power accounting, supply/demand diagnostics, accumulator behavior.
- Missing / next: power network graph with poles, transformer/transfer losses, alternative fuels, and network troubleshooting panel.
- Target: meaningful power planning before base scale-up, with visible shortfalls.

### Automation

- Implemented: runtime pause/step, history, templates, and automation toggles.
- Missing / next: mission-driven auto-build pipelines, replay-safe command plans, and failure-mode recovery for plans.
- Target: robust macro play with observable outcomes and rollback.

### Player systems

- Implemented: movement, interaction, collisions, fuel/refuel, hand interactions, HUD/probes.
- Missing / next: better fatigue/encumbrance, craftable tool progression, richer interaction surfaces, and accessibility-first navigation.
- Target: strong interaction clarity at all zoom levels and input modes.

### Testing and operations

- Implemented: deterministic unit/integration tests, movement gate, Playwright smoke.
- Missing / next: deterministic throughput benchmarks, scenario harness, perf budgets and baseline snapshots per milestone.
- Target: every high-impact feature has a gate and a migration-safe acceptance test.

## 4) “How we get there” plan

### Phase 0: Foundation hardening (already in progress)

- Keep simulation contracts strict, especially command validation and snapshot boundaries.
- Stabilize all non-visual rendering paths before adding complexity.
- Expand diagnostics for blocked miners, idle inserters, and power starvation.

### Phase 1: Production maturity

- Add throughput dashboards for all production chains.
- Add recipe unlock and recipe-category system.
- Add deterministic pipeline balancing for splitters and long belt lines.

### Phase 2: Logistics maturity

- Add underground belts and crossing constraints.
- Add filtered routing/lane control.
- Add belt and inserter throughput telemetry overlays.

### Phase 3: Power maturity

- Implement explicit power graph display and transfer capacity limits.
- Introduce alternative fuels and fuel economy tradeoffs.
- Add optional base-wide optimization challenge objectives.

### Phase 4: Automation and player growth

- Add goal-oriented missions tied to real mechanics.
- Add mission gating for new machine unlocks.
- Add scenario save artifacts and benchmarked difficulty tiers.

### Phase 5: Long-run scalability

- Add robots/train-like logistics shell.
- Add multiplayer-safe checkpoints and shareable blueprints.
- Add moderation-safe multiplayer collaboration workflow.

## 5) What “done” looks like for each phase

For any phase item to close, all conditions must pass:

- deterministic behavior: same commands, same outcomes, same tick ordering,
- observable UI: the HUD/minimap/probe signals that state changed,
- resilience: save/load and undo/replay preserve causality,
- coverage: targeted unit suite plus at least one Playwright checkpoint.

## 6) SPARK launch checklist (agent-swarm preflight)

Use this before every Agent Swarm pass. SPARK means:

- **S**cope: every agent has an exact deliverable with acceptance criteria,
- **P**lan: each task maps to an entry in this spec and an owning phase,
- **A**genda: sequence and dependency graph is known before coding,
- **R**eliability: each change has tests and a roll-forward/rollback step,
- **K**ickoff evidence: first task has a reproducible validation command and no unresolved blocker.

Agents are considered “sparked” only when all five SPARK checks are true.

## 7) Immediate “first launch” tasks

- finalize this matrix into an issue-level backlog with owner IDs,
- convert three largest production bottlenecks into explicit acceptance stories,
- add a production throughput dashboard card,
- add a power graph diagnostics card,
- add scenario-based E2E smoke with a fixed baseline factory build.

## 8) Documentation and process standards

- Every new gameplay loop ships with:
  - one specification update in this file,
  - one simulation test cluster,
  - one UI regression case when visible behavior changes,
  - one performance note in changelog docs.
- Before another agent-swarm launch, this spec must be updated with any changed scope or dependencies.

