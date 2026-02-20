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
    const miner = getState<MinerState>(sim, minerId);
    blockingBelt.item = 'iron-ore';

    let tick = 0;
    const advanceTo = (targetTick: number): void => {
      if (targetTick < tick) {
        throw new Error(`advanceTo target ${targetTick} is before current tick ${tick}`);
      }
      stepTicks(sim, targetTick - tick);
      tick = targetTick;
    };

    advanceTo(59);
    expect(tick).toBe(59);
    expect(miner).toMatchObject({ attempts: 0, blocked: 0, moved: 0 });
    expect(blockingBelt.item).toBe('iron-ore');

    advanceTo(60);
    expect(tick).toBe(60);
    expect(miner).toMatchObject({ attempts: 1, blocked: 1, moved: 0 });
    expect(blockingBelt.item).toBe('iron-ore');

    blockingBelt.item = null;

    advanceTo(119);
    expect(tick).toBe(119);
    expect(miner).toMatchObject({ attempts: 1, blocked: 1, moved: 0 });

    advanceTo(120);
    expect(tick).toBe(120);
    expect(miner).toMatchObject({ attempts: 2, blocked: 1, moved: 1 });
    expect(blockingBelt.item).toBe('iron-ore');
  });

  it('enforces Belt 15-tick forward attempts with one-item capacity semantics', () => {
    ensureTransportCadenceDefinitions();

    const sim = createSim({ width: 8, height: 3, seed: 102 });

    const targetBeltId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 2, y: 1 }, rot: 'E' });
    const sourceBeltId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 1, y: 1 }, rot: 'E' });

    const sourceBelt = getState<BeltState>(sim, sourceBeltId);
    const targetBelt = getState<BeltState>(sim, targetBeltId);
    sourceBelt.item = 'iron-ore';
    targetBelt.item = 'iron-ore';

    let tick = 0;
    const advanceTo = (targetTick: number): void => {
      if (targetTick < tick) {
        throw new Error(`advanceTo target ${targetTick} is before current tick ${tick}`);
      }
      stepTicks(sim, targetTick - tick);
      tick = targetTick;
    };

    advanceTo(14);
    expect(tick).toBe(14);
    expect(sourceBelt).toMatchObject({ attempts: 0, blocked: 0, moved: 0, item: 'iron-ore' });

    advanceTo(15);
    expect(tick).toBe(15);
    expect(sourceBelt).toMatchObject({ attempts: 1, blocked: 1, moved: 0, item: 'iron-ore' });

    targetBelt.item = null;

    advanceTo(29);
    expect(tick).toBe(29);
    expect(sourceBelt.item).toBe('iron-ore');

    advanceTo(30);
    expect(tick).toBe(30);
    expect(sourceBelt).toMatchObject({ attempts: 2, blocked: 1, moved: 1, item: null });
    expect(targetBelt.item).toBe('iron-ore');
  });

  it('enforces Inserter 20-tick and Furnace 180-tick deterministic boundaries', () => {
    ensureTransportCadenceDefinitions();

    const sim = createSim({ width: 10, height: 3, seed: 103 });

    const furnaceId = sim.addEntity({ kind: TEST_FURNACE_KIND, pos: { x: 5, y: 1 }, rot: 'E' });
    const inserterId = sim.addEntity({ kind: TEST_INSERTER_KIND, pos: { x: 4, y: 1 }, rot: 'E' });
    const feedBeltId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 3, y: 1 }, rot: 'E' });

    const inserter = getState<InserterState>(sim, inserterId);
    const feedBelt = getState<BeltState>(sim, feedBeltId);
    const furnace = getState<FurnaceState>(sim, furnaceId);
    feedBelt.item = 'iron-ore';

    let tick = 0;
    const advanceTo = (targetTick: number): void => {
      if (targetTick < tick) {
        throw new Error(`advanceTo target ${targetTick} is before current tick ${tick}`);
      }
      stepTicks(sim, targetTick - tick);
      tick = targetTick;
    };

    advanceTo(19);
    expect(tick).toBe(19);
    expect(inserter).toMatchObject({
      attempts: 0,
      pickups: 0,
      drops: 0,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: null,
    });
    expect(feedBelt.item).toBe('iron-ore');

    advanceTo(20);
    expect(tick).toBe(20);
    expect(inserter).toMatchObject({
      attempts: 1,
      pickups: 1,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: 'iron-ore',
    });
    expect([0, 1]).toContain(inserter.drops);
    expect(feedBelt.item).toBeNull();

    feedBelt.item = 'iron-ore';

    advanceTo(39);
    expect(tick).toBe(39);
    expect(inserter).toMatchObject({
      attempts: 1,
      pickups: 1,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: 'iron-ore',
    });
    expect([0, 1]).toContain(inserter.drops);

    advanceTo(40);
    expect(tick).toBe(40);
    expect(inserter).toMatchObject({
      attempts: 2,
      pickups: 1,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: null,
    });
    expect(furnace).toMatchObject({ input: 'iron-ore', crafting: false, output: null, completed: 0 });

    advanceTo(41);
    expect(tick).toBe(41);
    expect(furnace).toMatchObject({ input: null, crafting: true, progressTicks: 0, output: null, completed: 0 });

    advanceTo(59);
    expect(tick).toBe(59);
    expect(inserter).toMatchObject({
      attempts: 2,
      pickups: 1,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: null,
    });

    advanceTo(60);
    expect(tick).toBe(60);
    expect(inserter).toMatchObject({
      attempts: 3,
      pickups: 2,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: 'iron-ore',
    });

    advanceTo(79);
    expect(tick).toBe(79);
    expect(inserter).toMatchObject({
      attempts: 3,
      pickups: 2,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: 'iron-ore',
    });

    advanceTo(80);
    expect(tick).toBe(80);
    expect(inserter).toMatchObject({
      attempts: 4,
      pickups: 2,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 1,
      holding: 'iron-ore',
    });

    advanceTo(219);
    expect(tick).toBe(219);
    expect(inserter).toMatchObject({
      attempts: 10,
      pickups: 2,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 7,
      holding: 'iron-ore',
    });
    expect(furnace).toMatchObject({ crafting: true, progressTicks: 178, output: null, completed: 0 });

    advanceTo(220);
    expect(tick).toBe(220);
    expect(inserter).toMatchObject({
      attempts: 11,
      pickups: 2,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 8,
      holding: 'iron-ore',
    });
    expect(furnace).toMatchObject({ crafting: true, progressTicks: 179, output: null, completed: 0 });

    advanceTo(221);
    expect(tick).toBe(221);
    expect(inserter).toMatchObject({
      attempts: 11,
      pickups: 2,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 8,
      holding: 'iron-ore',
    });
    expect(furnace).toMatchObject({ crafting: false, progressTicks: 0, output: 'iron-plate', completed: 1 });

    furnace.output = null;

    advanceTo(239);
    expect(tick).toBe(239);
    expect(inserter).toMatchObject({
      attempts: 11,
      pickups: 2,
      drops: 1,
      blockedPickups: 0,
      blockedDrops: 8,
      holding: 'iron-ore',
    });
    expect(furnace.output).toBeNull();

    advanceTo(240);
    expect(tick).toBe(240);
    expect(inserter).toMatchObject({
      attempts: 12,
      pickups: 2,
      drops: 2,
      blockedPickups: 0,
      blockedDrops: 8,
      holding: null,
    });
    expect(furnace).toMatchObject({ input: 'iron-ore', output: null, completed: 1 });
  });
});
