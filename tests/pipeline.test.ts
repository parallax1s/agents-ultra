import { describe, expect, it } from 'vitest';

import { createSim } from '../src/core/sim';
import { getDefinition, registerEntity } from '../src/core/registry';
import type { Direction, EntityBase, ItemKind } from '../src/core/types';

const TICK_MS = 1000 / 60;

const MINER_ATTEMPT_TICKS = 60;
const BELT_ATTEMPT_TICKS = 15;
const INSERTER_ATTEMPT_TICKS = 20;
const FURNACE_SMELT_TICKS = 180;

const TEST_MINER_KIND = 'pipeline-test-miner-c60';
const TEST_BELT_KIND = 'pipeline-test-belt-c15';
const TEST_INSERTER_KIND = 'pipeline-test-inserter-c20';
const TEST_FURNACE_KIND = 'pipeline-test-furnace-c180';

type Vec = { x: number; y: number };

const DIR_V: Record<Direction, Vec> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

const OPPOSITE: Record<Direction, Direction> = {
  N: 'S',
  E: 'W',
  S: 'N',
  W: 'E',
};

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });

type MinerState = {
  ticks: number;
  holding: ItemKind | null;
  attempts: number;
  moved: number;
  blocked: number;
};

type BeltState = {
  ticks: number;
  item: ItemKind | null;
  attempts: number;
  moved: number;
  blocked: number;
};

type InserterState = {
  ticks: number;
  holding: ItemKind | null;
  attempts: number;
  pickups: number;
  drops: number;
  blockedPickups: number;
  blockedDrops: number;
};

type FurnaceState = {
  input: ItemKind | null;
  output: ItemKind | null;
  crafting: boolean;
  progressTicks: number;
  completed: number;
};

type SimWithGridLookup = {
  getEntitiesAt(pos: Vec): EntityBase[];
};

const asState = <T extends object>(value: unknown): T | undefined => {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }

  return value as T;
};

const getEntitiesAt = (sim: unknown, pos: Vec): EntityBase[] => {
  if (typeof sim !== 'object' || sim === null || !("getEntitiesAt" in sim)) {
    return [];
  }

  const candidate = sim as SimWithGridLookup;
  return typeof candidate.getEntitiesAt === 'function' ? candidate.getEntitiesAt(pos) : [];
};

const firstKindAt = (sim: unknown, pos: Vec, kind: string): EntityBase | undefined => {
  const entities = getEntitiesAt(sim, pos);
  return entities.find((entity) => entity.kind === kind);
};

const stepTicks = (sim: ReturnType<typeof createSim>, ticks: number): void => {
  for (let i = 0; i < ticks; i += 1) {
    sim.step(TICK_MS);
  }
};

const getState = <T extends object>(sim: ReturnType<typeof createSim>, id: string): T => {
  const entity = sim.getEntityById(id);
  expect(entity).toBeDefined();

  const state = asState<T>(entity?.state);
  expect(state).toBeDefined();

  return state as T;
};

const ensureTransportCadenceDefinitions = (): void => {
  if (getDefinition(TEST_MINER_KIND) === undefined) {
    registerEntity(TEST_MINER_KIND, {
      create: () => ({
        ticks: 0,
        holding: 'iron-ore' as ItemKind,
        attempts: 0,
        moved: 0,
        blocked: 0,
      }),
      update: (entity, _dtMs, sim) => {
        const state = asState<MinerState>(entity.state);
        if (!state) {
          return;
        }

        state.ticks += 1;
        if (state.ticks % MINER_ATTEMPT_TICKS !== 0) {
          return;
        }

        state.attempts += 1;
        if (state.holding === null) {
          state.holding = 'iron-ore';
        }

        const ahead = add(entity.pos, DIR_V[entity.rot]);
        const belt = firstKindAt(sim, ahead, TEST_BELT_KIND);
        const beltState = asState<BeltState>(belt?.state);

        if (!beltState || beltState.item !== null) {
          state.blocked += 1;
          return;
        }

        beltState.item = state.holding;
        state.holding = null;
        state.moved += 1;
      },
    });
  }

  if (getDefinition(TEST_BELT_KIND) === undefined) {
    registerEntity(TEST_BELT_KIND, {
      create: () => ({
        ticks: 0,
        item: null as ItemKind | null,
        attempts: 0,
        moved: 0,
        blocked: 0,
      }),
      update: (entity, _dtMs, sim) => {
        const state = asState<BeltState>(entity.state);
        if (!state) {
          return;
        }

        state.ticks += 1;
        if (state.ticks % BELT_ATTEMPT_TICKS !== 0 || state.item === null) {
          return;
        }

        state.attempts += 1;

        const ahead = add(entity.pos, DIR_V[entity.rot]);
        const targetBelt = firstKindAt(sim, ahead, TEST_BELT_KIND);
        const targetState = asState<BeltState>(targetBelt?.state);
        if (!targetState || targetState.item !== null) {
          state.blocked += 1;
          return;
        }

        targetState.item = state.item;
        state.item = null;
        state.moved += 1;
      },
    });
  }

  if (getDefinition(TEST_INSERTER_KIND) === undefined) {
    registerEntity(TEST_INSERTER_KIND, {
      create: () => ({
        ticks: 0,
        holding: null as ItemKind | null,
        attempts: 0,
        pickups: 0,
        drops: 0,
        blockedPickups: 0,
        blockedDrops: 0,
      }),
      update: (entity, _dtMs, sim) => {
        const state = asState<InserterState>(entity.state);
        if (!state) {
          return;
        }

        state.ticks += 1;
        if (state.ticks % INSERTER_ATTEMPT_TICKS !== 0) {
          return;
        }

        state.attempts += 1;

        if (state.holding === null) {
          const behind = add(entity.pos, DIR_V[OPPOSITE[entity.rot]]);
          const sourceBelt = firstKindAt(sim, behind, TEST_BELT_KIND);
          const sourceState = asState<BeltState>(sourceBelt?.state);
          if (!sourceState || sourceState.item === null) {
            state.blockedPickups += 1;
            return;
          }

          state.holding = sourceState.item;
          sourceState.item = null;
          state.pickups += 1;
          return;
        }

        const ahead = add(entity.pos, DIR_V[entity.rot]);
        const furnace = firstKindAt(sim, ahead, TEST_FURNACE_KIND);
        const furnaceState = asState<FurnaceState>(furnace?.state);

        if (!furnaceState || furnaceState.input !== null || furnaceState.crafting || furnaceState.output !== null) {
          state.blockedDrops += 1;
          return;
        }

        furnaceState.input = state.holding;
        state.holding = null;
        state.drops += 1;
      },
    });
  }

  if (getDefinition(TEST_FURNACE_KIND) === undefined) {
    registerEntity(TEST_FURNACE_KIND, {
      create: () => ({
        input: null as ItemKind | null,
        output: null as ItemKind | null,
        crafting: false,
        progressTicks: 0,
        completed: 0,
      }),
      update: (entity) => {
        const state = asState<FurnaceState>(entity.state);
        if (!state) {
          return;
        }

        if (!state.crafting) {
          if (state.input === 'iron-ore' && state.output === null) {
            state.crafting = true;
            state.input = null;
            state.progressTicks = 0;
          }
          return;
        }

        if (state.progressTicks < FURNACE_SMELT_TICKS) {
          state.progressTicks += 1;
        }

        if (state.progressTicks === FURNACE_SMELT_TICKS && state.output === null) {
          state.output = 'iron-plate';
          state.crafting = false;
          state.progressTicks = 0;
          state.completed += 1;
        }
      },
    });
  }
};

describe('Transport cadence regressions', () => {
  it('enforces Miner 60-tick gating with deterministic blocked and unblocked retries', () => {
    ensureTransportCadenceDefinitions();

    const sim = createSim({ width: 8, height: 3, seed: 101 });

    const blockingBeltId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 2, y: 1 }, rot: 'E' });
    const minerId = sim.addEntity({ kind: TEST_MINER_KIND, pos: { x: 1, y: 1 }, rot: 'E' });

    const blockingBelt = getState<BeltState>(sim, blockingBeltId);
    blockingBelt.item = 'iron-ore';

    stepTicks(sim, 59);
    expect(getState<MinerState>(sim, minerId)).toMatchObject({ attempts: 0, blocked: 0, moved: 0 });

    stepTicks(sim, 1);
    expect(getState<MinerState>(sim, minerId)).toMatchObject({ attempts: 1, blocked: 1, moved: 0 });
    expect(getState<BeltState>(sim, blockingBeltId).item).toBe('iron-ore');

    getState<BeltState>(sim, blockingBeltId).item = null;

    stepTicks(sim, 59);
    expect(getState<MinerState>(sim, minerId)).toMatchObject({ attempts: 1, blocked: 1, moved: 0 });

    stepTicks(sim, 1);
    expect(getState<MinerState>(sim, minerId)).toMatchObject({ attempts: 2, blocked: 1, moved: 1 });
    expect(getState<BeltState>(sim, blockingBeltId).item).toBe('iron-ore');
  });

  it('enforces Belt 15-tick forward attempts with one-item capacity semantics', () => {
    ensureTransportCadenceDefinitions();

    const sim = createSim({ width: 8, height: 3, seed: 102 });

    const targetBeltId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 2, y: 1 }, rot: 'E' });
    const sourceBeltId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 1, y: 1 }, rot: 'E' });

    getState<BeltState>(sim, targetBeltId).item = 'iron-ore';
    getState<BeltState>(sim, sourceBeltId).item = 'iron-ore';

    stepTicks(sim, 14);
    expect(getState<BeltState>(sim, sourceBeltId)).toMatchObject({ attempts: 0, blocked: 0, moved: 0, item: 'iron-ore' });

    stepTicks(sim, 1);
    expect(getState<BeltState>(sim, sourceBeltId)).toMatchObject({ attempts: 1, blocked: 1, moved: 0, item: 'iron-ore' });

    getState<BeltState>(sim, targetBeltId).item = null;

    stepTicks(sim, 14);
    expect(getState<BeltState>(sim, sourceBeltId).item).toBe('iron-ore');

    stepTicks(sim, 1);
    expect(getState<BeltState>(sim, sourceBeltId)).toMatchObject({ attempts: 2, blocked: 1, moved: 1, item: null });
    expect(getState<BeltState>(sim, targetBeltId).item).toBe('iron-ore');
  });

  it('enforces Inserter 20-tick sided transfers and Furnace 180-tick/output-backpressure boundaries', () => {
    ensureTransportCadenceDefinitions();

    const sim = createSim({ width: 10, height: 3, seed: 103 });

    const furnaceId = sim.addEntity({ kind: TEST_FURNACE_KIND, pos: { x: 5, y: 1 }, rot: 'E' });
    const inserterId = sim.addEntity({ kind: TEST_INSERTER_KIND, pos: { x: 4, y: 1 }, rot: 'E' });
    const feedBeltId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 3, y: 1 }, rot: 'E' });

    getState<BeltState>(sim, feedBeltId).item = 'iron-ore';

    let tick = 0;
    const advance = (ticks: number): void => {
      stepTicks(sim, ticks);
      tick += ticks;
    };

    advance(19);
    expect(tick).toBe(19);
    expect(getState<InserterState>(sim, inserterId)).toMatchObject({
      attempts: 0,
      pickups: 0,
      drops: 0,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: null,
    });
    expect(getState<BeltState>(sim, feedBeltId).item).toBe('iron-ore');

    advance(1);
    expect(tick).toBe(20);
    expect(getState<InserterState>(sim, inserterId)).toMatchObject({
      attempts: 1,
      pickups: 1,
      drops: 0,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: 'iron-ore',
    });
    expect(getState<BeltState>(sim, feedBeltId).item).toBeNull();

    getState<BeltState>(sim, feedBeltId).item = 'iron-ore';

    advance(19);
    expect(tick).toBe(39);
    expect(getState<InserterState>(sim, inserterId)).toMatchObject({
      attempts: 1,
      pickups: 1,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: 'iron-ore',
    });
    expect(getState<FurnaceState>(sim, furnaceId)).toMatchObject({ input: null, crafting: false, output: null, completed: 0 });

    advance(1);
    expect(tick).toBe(40);
    expect(getState<InserterState>(sim, inserterId)).toMatchObject({
      attempts: 2,
      pickups: 1,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: null,
    });
    expect(getState<FurnaceState>(sim, furnaceId)).toMatchObject({ input: 'iron-ore', crafting: false, output: null, completed: 0 });

    advance(1);
    expect(tick).toBe(41);
    expect(getState<FurnaceState>(sim, furnaceId)).toMatchObject({ input: null, crafting: true, progressTicks: 0, output: null, completed: 0 });

    advance(19);
    expect(tick).toBe(60);
    expect(getState<InserterState>(sim, inserterId)).toMatchObject({
      attempts: 3,
      pickups: 2,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: 'iron-ore',
    });

    advance(19);
    expect(tick).toBe(79);
    expect(getState<InserterState>(sim, inserterId)).toMatchObject({
      attempts: 3,
      pickups: 2,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: 'iron-ore',
    });

    advance(1);
    expect(tick).toBe(80);
    expect(getState<InserterState>(sim, inserterId)).toMatchObject({
      attempts: 4,
      pickups: 2,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 1,
      holding: 'iron-ore',
    });

    advance(140);
    expect(tick).toBe(220);
    expect(getState<InserterState>(sim, inserterId)).toMatchObject({
      attempts: 11,
      pickups: 2,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 8,
      holding: 'iron-ore',
    });
    expect(getState<FurnaceState>(sim, furnaceId)).toMatchObject({ crafting: true, progressTicks: 179, output: null, completed: 0 });

    advance(1);
    expect(tick).toBe(221);
    expect(getState<InserterState>(sim, inserterId)).toMatchObject({
      attempts: 11,
      pickups: 2,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 8,
      holding: 'iron-ore',
    });
    expect(getState<FurnaceState>(sim, furnaceId)).toMatchObject({ crafting: false, progressTicks: 0, output: 'iron-plate', completed: 1 });

    advance(39);
    expect(tick).toBe(260);
    expect(getState<InserterState>(sim, inserterId)).toMatchObject({
      attempts: 13,
      pickups: 2,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 10,
      holding: 'iron-ore',
    });
    expect(getState<FurnaceState>(sim, furnaceId).output).toBe('iron-plate');

    getState<FurnaceState>(sim, furnaceId).output = null;

    advance(19);
    expect(tick).toBe(279);
    expect(getState<InserterState>(sim, inserterId)).toMatchObject({
      attempts: 13,
      pickups: 2,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 10,
      holding: 'iron-ore',
    });
    expect(getState<FurnaceState>(sim, furnaceId).output).toBeNull();

    advance(1);
    expect(tick).toBe(280);
    expect(getState<InserterState>(sim, inserterId)).toMatchObject({
      attempts: 14,
      pickups: 2,
      drops: 2,
      blockedPickups: 0,
      blockedDrops: 10,
      holding: null,
    });
    expect(getState<FurnaceState>(sim, furnaceId)).toMatchObject({ input: 'iron-ore', output: null, completed: 1 });
  });
});
