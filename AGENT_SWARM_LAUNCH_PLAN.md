# Agent Swarm Launch Pack (SPARK)

Purpose: keep every agent aligned to the end-goal, deterministic enough to work without drift, and auditable.

Use this before each launch to make sure all agents are effectively `SPARK`-ready:

- **S**cope: exact task boundaries + acceptance criteria
- **P**lan: dependency order and ownership
- **A**genda: concrete execution sequence
- **R**eliability: test and rollback plan
- **K**ickoff evidence: proof each agent started with the same source truth

## 1) Launch prerequisites

1. Pull latest `main`.
2. Verify docs baseline:
   - `ENDGOAL_SPEC.md`
   - `FACTORIO_GAP_FEATURES.md`
   - `FEATURE_ROADMAP.md`
   - `FEATURE_MATRIX.md`
   - `FEATURES.json`
3. Confirm current branch status is clean:
   - `git status --short` should be empty.
4. Confirm toolchain:
   - `node -v` is installed.
   - `npm -v` is installed.
5. Run local gate before dispatch:
   - `npm run test:movement`
   - `npm run agent:workflow`

## 2) SPARK scope definitions for the next batch

### S1 — Throughput and diagnostics clarity (Production Maturity Phase 1)
- Goal: make manufacturing bottlenecks and throughput visible and actionable.
- Acceptance:
  - Per-entity throughput counters are visible on relevant entities.
  - A new HUD panel shows aggregate throughput, stalled reasons, and cycle utilization.
  - No existing tests regress.

### S2 — Recipe unlock progression shell
- Goal: introduce recipe gating without changing core tick semantics.
- Acceptance:
  - Recipe catalog can mark locked/unlocked state.
  - Assembler refuses locked recipes.
  - A scriptable unlock hook exists (for future research missions).
  - Deterministic behavior preserved.

### S3 — Logistics control primitives
- Goal: route better before adding robots.
- Acceptance:
  - Belt/route hints for lane congestion (non-intrusive UI).
  - Explicit filtered lane behavior for at least one handoff path in splitters or inserter handoff flow.
  - No deadlock from the new hinting logic.

### S4 — Test and validation hardening
- Goal: every gameplay change gets direct regression coverage.
- Acceptance:
  - New scenarios in unit tests for each SPARK scope.
  - One Playwright smoke per scope with visible assertions.
  - `npm run agent:workflow -- --strict` completes.

## 3) Task cards (assignable to agents)

| Card ID | Agent track | Task | Owner file targets | Evidence |
| --- | --- | --- | --- | --- |
| SPARK-P1 | Simulation engineer | Implement deterministic throughput stats in simulation metrics and entity-level counters | `src/core/sim.ts`, `src/core/snapshot.ts`, `src/core/types.ts`, `src/entities/*` | Unit test proving no counter drift across 180 ticks |
| SPARK-P2 | UI engineer | Add throughput/throughput-limits diagnostics HUD panel | `src/ui/App.tsx`, `src/ui/renderer.ts` | E2E screenshot/state assertions for panel values |
| SPARK-P3 | Simulation engineer | Add recipe gating primitives and locked-by-default starter recipe path | `src/recipes.ts`, `src/core/sim.ts`, `src/entities/furnace.ts`, `src/entities/assembler.ts` | Unit test for locked recipe rejection + unlock event |
| SPARK-P4 | Gameplay engineer | Add lane/congestion hint markers on minimap and/or world | `src/ui/renderer.ts`, `src/ui/App.tsx` | Manual + automated check for hint rendering and no click regression |
| SPARK-P5 | QA agent | Add/extend regression tests for new features | `tests/*.test.ts`, `tests/e2e/*.spec.ts`, `tests/*.ts` | All movement gates and e2e scenario validations pass |
| SPARK-P6 | Documentation owner | Extend end-goal spec and roadmap statuses for shipped changes | `ENDGOAL_SPEC.md`, `FEATURE_ROADMAP.md`, `FEATURES.json`, `README.md` | Docs commit with matrix updates and test references |

## 4) Agenda and ordering

1. Launch all agents with shared scope definitions and immutable docs.
2. Assign S1/S2 before S3 to avoid churn from new diagnostics APIs.
3. Run local gates immediately after each card is claimed:
   - `npm run typecheck`
   - `npm run test:movement`
4. Merge and re-run:
   - `npm run agent:workflow -- --strict`
5. Update docs (`FEATURE_MATRIX.md`, `FEATURES.json`, and `FEATURE_ROADMAP.md`) within same merge window.

## 5) Reliability and rollback plan

### Reliability gates per agent
- Code review of touched `src/core/*` for determinism contract compliance.
- Unit test pass for all changed systems.
- `npm run agent:workflow` after every merged commit block.
- If any gate fails, revert only the changed block and rerun the sequence before continuing.

### Rollback
- Tag pre-launch commit: `pre-spark-launch`.
- If an issue is introduced, revert the latest commit only, re-run gates, then re-launch corrected task card.

## 6) Kickoff evidence package

Each agent must include in comments or handoff notes:

- Branch + commit hash.
- Exact task card ID.
- Validation commands run.
- Expected before/after metrics or snapshots.
- Any blocked dependencies.

## 7) Standard handoff format (copy/paste)

```
Agent: <name or id>
Card: SPARK-Px
Status: in_progress | blocked | review | done
Validation:
- npm run typecheck
- npm run test:movement
- npm run test:e2e (or e2e:strict if available)
Notes:
- files touched:
- behavior changed:
- risks:
- next step:
```

## 8) Launch command sequence

1. `git checkout main`
2. `git pull origin main`
3. `git status --short`
4. `npm install`
5. `npm run test:movement`
6. `npm run agent:workflow`
7. Dispatch to agents with card IDs and evidence template
8. Enforce one-card-at-a-time integration reviews
9. Push only when SPARK-P5 confirms both unit and e2e gates

This launch pack is a living artifact. Update it whenever priority changes or dependencies are discovered.
