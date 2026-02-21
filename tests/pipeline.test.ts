import { describe, expect, it } from 'vitest';

import { createSim } from '../src/core/sim';
import { getDefinition, registerEntity } from '../src/core/registry';
import '../src/entities/all';
import {
  DIRECTION_SEQUENCE,
  DIRECTION_VECTORS,
  OPPOSITE_DIRECTION,
  rotateDirection,
  type Direction,
  type EntityBase,
  type ItemKind,
} from '../src/core/types';

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

const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });

type RelativeSide = 'front' | 'right' | 'back' | 'left';

const sideToDirection = (facing: Direction, side: RelativeSide): Direction => {
  if (side === 'front') {
    return facing;
  }

  if (side === 'back') {
    return OPPOSITE_DIRECTION[facing];
  }

  return side === 'right' ? rotateDirection(facing, 1) : rotateDirection(facing, -1);
};

const sideOffset = (facing: Direction, side: RelativeSide): Vec => {
  return DIRECTION_VECTORS[sideToDirection(facing, side)];
};

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
  _pipelineTestReceivedTick?: number;
};

type InserterCoreState = {
  holding: ItemKind | null;
};

type BeltCellState = {
  item: ItemKind | null;
  buffer?: ItemKind | null;
  items?: (ItemKind | null)[];
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

type SharedTargetRaceState = {
  tick: number;
  sourceWest: BeltState;
  sourceSouth: BeltState;
  sharedTarget: BeltState;
};

type CanonicalBeltState = {
  tickPhase: number;
  item: ItemKind | null;
  items: [ItemKind | null];
  buffer: ItemKind | null;
};

type CanonicalInserterState = {
  tickPhase: number;
  holding: ItemKind | null;
  state: 0 | 1 | 2 | 3;
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

        const ahead = add(entity.pos, DIRECTION_VECTORS[entity.rot]);
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
        if (state.ticks % BELT_ATTEMPT_TICKS !== 0) {
          return;
        }

        const receivesThisTick = state._pipelineTestReceivedTick === state.ticks;
        if (state.item === null && !receivesThisTick) {
          return;
        }

        state.attempts += 1;
        if (receivesThisTick) {
          const ahead = add(entity.pos, DIRECTION_VECTORS[entity.rot]);
          const targetBelt = firstKindAt(sim, ahead, TEST_BELT_KIND);
          const targetState = asState<BeltState>(targetBelt?.state);

          if (!targetState || targetState.item !== null || targetState._pipelineTestReceivedTick === state.ticks) {
            state.blocked += 1;
          }

          return;
        }

        const ahead = add(entity.pos, DIRECTION_VECTORS[entity.rot]);
        const targetBelt = firstKindAt(sim, ahead, TEST_BELT_KIND);
        const targetState = asState<BeltState>(targetBelt?.state);
        if (
          !targetState ||
          targetState.item !== null ||
          targetState._pipelineTestReceivedTick === state.ticks
        ) {
          state.blocked += 1;
          return;
        }

        targetState.item = state.item;
        targetState._pipelineTestReceivedTick = state.ticks;
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
          const behind = add(entity.pos, DIRECTION_VECTORS[OPPOSITE_DIRECTION[entity.rot]]);
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

        const ahead = add(entity.pos, DIRECTION_VECTORS[entity.rot]);
        const dropTargets = getEntitiesAt(sim, ahead);
        for (const target of dropTargets) {
          if (target.id === entity.id) {
            continue;
          }

          if (target.kind === TEST_BELT_KIND) {
            const targetBeltState = asState<BeltState>(target.state);
            if (!targetBeltState || targetBeltState.item !== null) {
              continue;
            }
            targetBeltState.item = state.holding;
            state.holding = null;
            state.drops += 1;
            return;
          }

          if (target.kind === TEST_FURNACE_KIND) {
            const furnaceState = asState<FurnaceState>(target.state);
            if (!furnaceState || furnaceState.input !== null || furnaceState.crafting || furnaceState.output !== null) {
              continue;
            }
            furnaceState.input = state.holding;
            state.holding = null;
            state.drops += 1;
            return;
          }
        }

        state.blockedDrops += 1;
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

const runSharedTargetBeltRace = (): SharedTargetRaceState => {
  ensureTransportCadenceDefinitions();

  const sim = createSim({ width: 4, height: 4, seed: 222 });

  const westSourceId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 1, y: 2 }, rot: 'W' });
  const southSourceId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 0, y: 1 }, rot: 'S' });
  const sharedTargetId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 0, y: 2 }, rot: 'W' });

  const westSource = getState<BeltState>(sim, westSourceId);
  const southSource = getState<BeltState>(sim, southSourceId);
  const sharedTarget = getState<BeltState>(sim, sharedTargetId);
  westSource.item = 'iron-ore';
  southSource.item = 'iron-plate';

  stepTicks(sim, 30);

  return {
    tick: sim.tickCount,
    sourceWest: { ...westSource },
    sourceSouth: { ...southSource },
    sharedTarget: { ...sharedTarget },
  };
};

const setupCustomInserterTransferScenario = (
  rotation: Direction,
  item: ItemKind,
): {
  readonly sim: ReturnType<typeof createSim>;
  readonly inserter: InserterCoreState;
  readonly sourceBelt: BeltCellState;
  readonly targetBelt: BeltCellState;
  readonly advanceTo: (targetTick: number) => void;
} => {
  const sim = createSim({ width: 10, height: 4, seed: 701 });
  const inserterPos: Vec = { x: 4, y: 2 };
  const sourcePos = add(inserterPos, DIRECTION_VECTORS[OPPOSITE_DIRECTION[rotation]]);
  const targetPos = add(inserterPos, DIRECTION_VECTORS[rotation]);

  ensureTransportCadenceDefinitions();
  const sourceId = sim.addEntity({ kind: TEST_BELT_KIND, pos: sourcePos, rot: rotation });
  const inserterId = sim.addEntity({ kind: TEST_INSERTER_KIND, pos: inserterPos, rot: rotation });
  const targetId = sim.addEntity({ kind: TEST_BELT_KIND, pos: targetPos, rot: OPPOSITE_DIRECTION[rotation] });

  const inserter = getState<InserterCoreState>(sim, inserterId);
  const sourceBelt = getState<BeltCellState>(sim, sourceId);
  const targetBelt = getState<BeltCellState>(sim, targetId);
  sourceBelt.item = item;

  let tick = 0;
  const advanceTo = (targetTick: number): void => {
    if (targetTick < tick) {
      throw new Error(`advanceTo target ${targetTick} is before current tick ${tick}`);
    }
    stepTicks(sim, targetTick - tick);
    tick = targetTick;
  };

  return { sim, inserter, sourceBelt, targetBelt, advanceTo };
};

const countItems = (...items: Array<ItemKind | null | undefined>): number => {
  return items.filter((item) => item === 'iron-ore' || item === 'iron-plate').length;
};

const runCanonicalBeltCapacityEdgeScenario = (): {
  tick: number;
  westItem: ItemKind | null;
  southItem: ItemKind | null;
  targetItem: ItemKind | null;
  sinkItem: ItemKind | null;
  totalItems: number;
} => {
  const sim = createSim({ width: 10, height: 5, seed: 910 });

  const targetId = sim.addEntity({ kind: 'belt', pos: { x: 2, y: 2 }, rot: 'E' });
  const sinkId = sim.addEntity({ kind: 'belt', pos: { x: 3, y: 2 }, rot: 'E' });
  const westSourceId = sim.addEntity({ kind: 'belt', pos: { x: 1, y: 2 }, rot: 'E' });
  const southSourceId = sim.addEntity({ kind: 'belt', pos: { x: 2, y: 3 }, rot: 'N' });

  const target = getState<CanonicalBeltState>(sim, targetId);
  const sink = getState<CanonicalBeltState>(sim, sinkId);
  const westSource = getState<CanonicalBeltState>(sim, westSourceId);
  const southSource = getState<CanonicalBeltState>(sim, southSourceId);

  sink.item = 'iron-plate';
  westSource.item = 'iron-ore';
  southSource.item = 'iron-plate';
  sink.buffer = sink.item;
  sink.items = [sink.item];
  westSource.buffer = westSource.item;
  westSource.items = [westSource.item];
  southSource.buffer = southSource.item;
  southSource.items = [southSource.item];

  stepTicks(sim, BELT_ATTEMPT_TICKS);

  return {
    tick: sim.tickCount,
    westItem: westSource.item,
    southItem: southSource.item,
    targetItem: target.item,
    sinkItem: sink.item,
    totalItems: countItems(westSource.item, southSource.item, target.item, sink.item),
  };
};

const runCanonicalInserterBlockedCadenceScenario = (): {
  tick20: { tick: number; source: ItemKind | null; holding: ItemKind | null; target: ItemKind | null; total: number };
  tick40: { tick: number; source: ItemKind | null; holding: ItemKind | null; target: ItemKind | null; total: number };
  tick79: { tick: number; source: ItemKind | null; holding: ItemKind | null; target: ItemKind | null; total: number };
  tick80: { tick: number; source: ItemKind | null; holding: ItemKind | null; target: ItemKind | null; total: number };
} => {
  const sim = createSim({ width: 10, height: 4, seed: 911 });

  const sourceId = sim.addEntity({ kind: 'belt', pos: { x: 1, y: 1 }, rot: 'W' });
  const inserterId = sim.addEntity({ kind: 'inserter', pos: { x: 2, y: 1 }, rot: 'E' });
  const targetId = sim.addEntity({ kind: 'belt', pos: { x: 3, y: 1 }, rot: 'W' });

  const source = getState<CanonicalBeltState>(sim, sourceId);
  const inserter = getState<CanonicalInserterState>(sim, inserterId);
  const target = getState<CanonicalBeltState>(sim, targetId);

  source.item = 'iron-ore';
  source.buffer = source.item;
  source.items = [source.item];
  target.item = 'iron-plate';
  target.buffer = target.item;
  target.items = [target.item];

  stepTicks(sim, 20);
  const tick20 = {
    tick: sim.tickCount,
    source: source.item,
    holding: inserter.holding,
    target: target.item,
    total: countItems(source.item, inserter.holding, target.item),
  };

  source.item = 'iron-ore';
  source.buffer = source.item;
  source.items = [source.item];
  stepTicks(sim, 20);
  const tick40 = {
    tick: sim.tickCount,
    source: source.item,
    holding: inserter.holding,
    target: target.item,
    total: countItems(source.item, inserter.holding, target.item),
  };

  target.item = null;
  target.buffer = null;
  target.items = [null];
  stepTicks(sim, 39);
  const tick79 = {
    tick: sim.tickCount,
    source: source.item,
    holding: inserter.holding,
    target: target.item,
    total: countItems(source.item, inserter.holding, target.item),
  };

  stepTicks(sim, 1);
  const tick80 = {
    tick: sim.tickCount,
    source: source.item,
    holding: inserter.holding,
    target: target.item,
    total: countItems(source.item, inserter.holding, target.item),
  };

  return { tick20, tick40, tick79, tick80 };
};

describe('Transport cadence regressions', () => {
  it('replays shared-target belt contention with deterministic winner/loser outcomes', () => {
    const first = runSharedTargetBeltRace();
    const second = runSharedTargetBeltRace();

    expect(first).toEqual(second);
    expect(first.tick).toBe(30);
    expect(first.sharedTarget).toMatchObject({
      item: 'iron-ore',
      attempts: 2,
      moved: 0,
      blocked: 2,
    });
    expect(first.sourceWest).toMatchObject({
      item: null,
      attempts: 1,
      moved: 1,
      blocked: 0,
    });
    expect(first.sourceSouth).toMatchObject({
      item: 'iron-plate',
      attempts: 2,
      moved: 0,
      blocked: 2,
    });
  });

  it('resolves mixed belt/inserter contention on a shared target with deterministic winner/loser outcomes', () => {
    ensureTransportCadenceDefinitions();

    const sim = createSim({ width: 10, height: 5, seed: 305 });

    const targetId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 5, y: 2 }, rot: 'E' });
    const beltSourceId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 4, y: 2 }, rot: 'E' });
    const inserterId = sim.addEntity({ kind: TEST_INSERTER_KIND, pos: { x: 5, y: 1 }, rot: 'S' });
    const inserterFeedId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 5, y: 0 }, rot: 'S' });

    const target = getState<BeltState>(sim, targetId);
    const beltSource = getState<BeltState>(sim, beltSourceId);
    const inserter = getState<InserterState>(sim, inserterId);
    const inserterFeed = getState<BeltState>(sim, inserterFeedId);

    target.item = 'iron-ore';
    beltSource.item = 'iron-plate';
    inserterFeed.item = 'iron-ore';

    let tick = 0;
    const advanceTo = (targetTick: number): void => {
      if (targetTick < tick) {
        throw new Error(`advanceTo target ${targetTick} is before current tick ${tick}`);
      }

      stepTicks(sim, targetTick - tick);
      tick = targetTick;
    };

    advanceTo(20);
    expect(tick).toBe(20);
    expect(inserter).toMatchObject({
      attempts: 1,
      pickups: 1,
      drops: 0,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: 'iron-ore',
    });
    expect(beltSource).toMatchObject({ attempts: 1, moved: 0, blocked: 1, item: 'iron-plate' });

    advanceTo(40);
    expect(tick).toBe(40);
    expect(inserter).toMatchObject({
      attempts: 2,
      pickups: 1,
      drops: 0,
      blockedPickups: 0,
      blockedDrops: 1,
      holding: 'iron-ore',
    });
    expect(target.item).toBe('iron-ore');
    expect(beltSource).toMatchObject({ attempts: 2, moved: 0, blocked: 2, item: 'iron-plate' });

    advanceTo(59);
    expect(tick).toBe(59);
    target.item = null;

    advanceTo(60);
    expect(tick).toBe(60);
    expect(target.item).toBe('iron-plate');
    expect(beltSource).toMatchObject({ attempts: 4, moved: 1, blocked: 3, item: null });
    expect(inserter).toMatchObject({
      attempts: 3,
      pickups: 1,
      drops: 0,
      blockedPickups: 0,
      blockedDrops: 2,
      holding: 'iron-ore',
    });
  });

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
    expect(inserter.drops).toBe(0);
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
    expect(inserter.drops).toBe(0);

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

  it('enforces one belt hop per 15-tick cadence and prevents chained same-tick multi-hop', () => {
    ensureTransportCadenceDefinitions();

    const sim = createSim({ width: 8, height: 3, seed: 301 });

    const sourceId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 1, y: 1 }, rot: 'E' });
    const middleId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 2, y: 1 }, rot: 'E' });
    const sinkId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 3, y: 1 }, rot: 'E' });

    const source = getState<BeltState>(sim, sourceId);
    const middle = getState<BeltState>(sim, middleId);
    const sink = getState<BeltState>(sim, sinkId);

    source.item = 'iron-ore';

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
    expect(source).toMatchObject({ item: 'iron-ore', attempts: 0, moved: 0, blocked: 0 });
    expect(middle).toMatchObject({ item: null, attempts: 0, moved: 0, blocked: 0 });
    expect(sink).toMatchObject({ item: null, attempts: 0, moved: 0, blocked: 0 });

    advanceTo(15);
    expect(tick).toBe(15);
    expect(source).toMatchObject({ item: null, attempts: 1, moved: 1, blocked: 0 });
    expect(middle).toMatchObject({ item: 'iron-ore', attempts: 1, moved: 0, blocked: 0 });
    expect(sink).toMatchObject({ item: null, attempts: 0, moved: 0, blocked: 0 });

    advanceTo(29);
    expect(tick).toBe(29);
    expect(source).toMatchObject({ item: null, moved: 1, attempts: 1 });
    expect(middle).toMatchObject({ item: 'iron-ore', moved: 0, attempts: 1 });
    expect(sink).toMatchObject({ item: null, moved: 0, attempts: 0 });

    advanceTo(30);
    expect(tick).toBe(30);
    expect(source).toMatchObject({ item: null, moved: 1, attempts: 1 });
    expect(middle).toMatchObject({ item: null, attempts: 2, moved: 1, blocked: 0 });
    expect(sink).toMatchObject({ item: 'iron-ore' });

    advanceTo(44);
    expect(tick).toBe(44);
    expect(source).toMatchObject({ item: null });
    expect(middle).toMatchObject({ item: null });
    expect(sink).toMatchObject({ item: 'iron-ore' });
  });

  it('advances inserters only at 20-tick cadence boundaries', () => {
    ensureTransportCadenceDefinitions();

    const sim = createSim({ width: 10, height: 3, seed: 302 });

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

    advanceTo(20);
    expect(tick).toBe(20);
    expect(inserter).toMatchObject({
      attempts: 1,
      pickups: 1,
      drops: 0,
      blockedPickups: 0,
      blockedDrops: 0,
      holding: 'iron-ore',
    });
    expect(feedBelt.item).toBeNull();

    advanceTo(39);
    expect(tick).toBe(39);
    expect(inserter).toMatchObject({
      attempts: 1,
      pickups: 1,
      drops: 0,
      blockedPickups: 0,
      blockedDrops: 0,
    });

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
    expect(furnace.input).toBe('iron-ore');
    expect(furnace.crafting).toBe(false);
    expect(furnace.progressTicks).toBe(0);
    expect(furnace.output).toBeNull();

    feedBelt.item = 'iron-ore';

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
  });

  it('lets miners emit only on accepted downstream slots and only every 60-tick attempt', () => {
    ensureTransportCadenceDefinitions();

    const sim = createSim({ width: 8, height: 3, seed: 303 });

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
    expect(miner).toMatchObject({
      ticks: 59,
      attempts: 0,
      moved: 0,
      blocked: 0,
      holding: 'iron-ore',
    });
    expect(blockingBelt.item).toBe('iron-ore');

    advanceTo(60);
    expect(tick).toBe(60);
    expect(miner).toMatchObject({
      ticks: 60,
      attempts: 1,
      moved: 0,
      blocked: 1,
      holding: 'iron-ore',
    });
    expect(blockingBelt.item).toBe('iron-ore');

    blockingBelt.item = null;

    advanceTo(119);
    expect(tick).toBe(119);
    expect(miner).toMatchObject({
      attempts: 1,
      moved: 0,
      blocked: 1,
      holding: 'iron-ore',
    });

    advanceTo(120);
    expect(tick).toBe(120);
    expect(miner).toMatchObject({
      attempts: 2,
      moved: 1,
      blocked: 1,
      holding: null,
    });
    expect(blockingBelt.item).toBe('iron-ore');
  });

  it('halts transport movement while paused and resumes from the exact prior cadence phase', () => {
    ensureTransportCadenceDefinitions();

    const sim = createSim({ width: 8, height: 3, seed: 304 });

    const sourceId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 1, y: 1 }, rot: 'E' });
    const targetId = sim.addEntity({ kind: TEST_BELT_KIND, pos: { x: 2, y: 1 }, rot: 'E' });

    const source = getState<BeltState>(sim, sourceId);
    const target = getState<BeltState>(sim, targetId);
    source.item = 'iron-ore';

    stepTicks(sim, 14);
    expect(sim.tickCount).toBe(14);
    expect(source).toMatchObject({ item: 'iron-ore', moved: 0, attempts: 0, blocked: 0 });
    expect(target).toMatchObject({ item: null, moved: 0, attempts: 0, blocked: 0 });

    const snapshot = {
      tickCount: sim.tickCount,
      elapsedMs: sim.elapsedMs,
      source: { ...source },
      target: { ...target },
    };

    sim.pause();
    stepTicks(sim, 42);
    sim.resume();

    expect(sim.tickCount).toBe(snapshot.tickCount);
    expect(sim.elapsedMs).toBe(snapshot.elapsedMs);
    expect(source).toMatchObject(snapshot.source);
    expect(target).toMatchObject(snapshot.target);

    sim.step(TICK_MS / 2);
    expect(sim.tickCount).toBe(14);
    expect(source).toMatchObject(snapshot.source);
    expect(target).toMatchObject(snapshot.target);

    sim.step(TICK_MS / 2);
    expect(sim.tickCount).toBe(15);
    expect(source).toMatchObject({ item: null, moved: 1, attempts: 1, blocked: 0 });
    expect(target).toMatchObject({ item: 'iron-ore', moved: 0, attempts: 1 });
  });

  it('moves ore and plates in all 4 orientations with 20-tick transfer cadence', () => {
    for (const rotation of DIRECTION_SEQUENCE) {
      for (const item of ['iron-ore', 'iron-plate'] as const) {
        const { inserter, sourceBelt, targetBelt, advanceTo } = setupCustomInserterTransferScenario(rotation, item);

        advanceTo(19);
        expect(inserter.holding).toBeNull();
        expect(sourceBelt.item).toBe(item);
        expect(targetBelt.item).toBeNull();

        advanceTo(20);
        expect(inserter.holding).toBe(item);
        expect(sourceBelt.item).toBeNull();

        advanceTo(39);
        expect(inserter.holding).toBe(item);
        expect(targetBelt.item).toBeNull();

        advanceTo(40);
        expect(inserter.holding).toBeNull();
        expect(targetBelt.item).toBe(item);
      }
    }
  });

  it('keeps directional helpers aligned to canonical clockwise and opposite contracts', () => {
    for (let i = 0; i < DIRECTION_SEQUENCE.length; i += 1) {
      const facing = DIRECTION_SEQUENCE[i];
      const expectedRight = DIRECTION_SEQUENCE[(i + 1) % DIRECTION_SEQUENCE.length];
      const expectedBack = DIRECTION_SEQUENCE[(i + 2) % DIRECTION_SEQUENCE.length];
      const expectedLeft = DIRECTION_SEQUENCE[(i + 3) % DIRECTION_SEQUENCE.length];

      expect(rotateDirection(facing, 1)).toBe(expectedRight);
      expect(rotateDirection(facing, 2)).toBe(expectedBack);
      expect(rotateDirection(facing, -1)).toBe(expectedLeft);
      expect(OPPOSITE_DIRECTION[facing]).toBe(expectedBack);

      expect(sideToDirection(facing, 'front')).toBe(facing);
      expect(sideToDirection(facing, 'right')).toBe(expectedRight);
      expect(sideToDirection(facing, 'back')).toBe(expectedBack);
      expect(sideToDirection(facing, 'left')).toBe(expectedLeft);
    }
  });

  it('keeps miner, belt, and inserter side mappings consistent across all orientations', () => {
    ensureTransportCadenceDefinitions();

    const center: Vec = { x: 4, y: 4 };
    for (let index = 0; index < DIRECTION_SEQUENCE.length; index += 1) {
      const facing = DIRECTION_SEQUENCE[index];

      {
        const sim = createSim({ width: 10, height: 10, seed: 1200 + index });
        const minerId = sim.addEntity({ kind: TEST_MINER_KIND, pos: center, rot: facing });
        const frontId = sim.addEntity({ kind: TEST_BELT_KIND, pos: add(center, sideOffset(facing, 'front')), rot: facing });
        const rightId = sim.addEntity({ kind: TEST_BELT_KIND, pos: add(center, sideOffset(facing, 'right')), rot: facing });
        const backId = sim.addEntity({ kind: TEST_BELT_KIND, pos: add(center, sideOffset(facing, 'back')), rot: facing });
        const leftId = sim.addEntity({ kind: TEST_BELT_KIND, pos: add(center, sideOffset(facing, 'left')), rot: facing });

        const miner = getState<MinerState>(sim, minerId);
        const front = getState<BeltState>(sim, frontId);
        const right = getState<BeltState>(sim, rightId);
        const back = getState<BeltState>(sim, backId);
        const left = getState<BeltState>(sim, leftId);
        miner.holding = 'iron-ore';

        stepTicks(sim, MINER_ATTEMPT_TICKS);

        expect(front.item).toBe('iron-ore');
        expect(right.item).toBeNull();
        expect(back.item).toBeNull();
        expect(left.item).toBeNull();
      }

      {
        const sim = createSim({ width: 10, height: 10, seed: 1300 + index });
        const sourceId = sim.addEntity({ kind: TEST_BELT_KIND, pos: center, rot: facing });
        const frontId = sim.addEntity({ kind: TEST_BELT_KIND, pos: add(center, sideOffset(facing, 'front')), rot: facing });
        const rightId = sim.addEntity({ kind: TEST_BELT_KIND, pos: add(center, sideOffset(facing, 'right')), rot: facing });
        const backId = sim.addEntity({ kind: TEST_BELT_KIND, pos: add(center, sideOffset(facing, 'back')), rot: facing });
        const leftId = sim.addEntity({ kind: TEST_BELT_KIND, pos: add(center, sideOffset(facing, 'left')), rot: facing });

        const source = getState<BeltState>(sim, sourceId);
        const front = getState<BeltState>(sim, frontId);
        const right = getState<BeltState>(sim, rightId);
        const back = getState<BeltState>(sim, backId);
        const left = getState<BeltState>(sim, leftId);

        source.item = 'iron-plate';
        stepTicks(sim, BELT_ATTEMPT_TICKS);

        expect(source.item).toBeNull();
        expect(front.item).toBe('iron-plate');
        expect(right.item).toBeNull();
        expect(back.item).toBeNull();
        expect(left.item).toBeNull();
      }

      {
        const sim = createSim({ width: 10, height: 10, seed: 1400 + index });
        const inserterId = sim.addEntity({ kind: TEST_INSERTER_KIND, pos: center, rot: facing });
        const frontId = sim.addEntity({ kind: TEST_BELT_KIND, pos: add(center, sideOffset(facing, 'front')), rot: facing });
        const rightId = sim.addEntity({ kind: TEST_BELT_KIND, pos: add(center, sideOffset(facing, 'right')), rot: facing });
        const backId = sim.addEntity({ kind: TEST_BELT_KIND, pos: add(center, sideOffset(facing, 'back')), rot: facing });
        const leftId = sim.addEntity({ kind: TEST_BELT_KIND, pos: add(center, sideOffset(facing, 'left')), rot: facing });

        const inserter = getState<InserterState>(sim, inserterId);
        const front = getState<BeltState>(sim, frontId);
        const right = getState<BeltState>(sim, rightId);
        const back = getState<BeltState>(sim, backId);
        const left = getState<BeltState>(sim, leftId);

        front.item = null;
        right.item = 'iron-plate';
        back.item = 'iron-ore';
        left.item = 'iron-plate';

        stepTicks(sim, INSERTER_ATTEMPT_TICKS);
        expect(inserter.holding).toBe('iron-ore');
        expect(back.item).toBeNull();
        expect(right.item).toBe('iron-plate');
        expect(left.item).toBe('iron-plate');

        stepTicks(sim, INSERTER_ATTEMPT_TICKS);
        expect(inserter.holding).toBeNull();
        expect(front.item).toBe('iron-ore');
        expect(right.item).toBe('iron-plate');
        expect(left.item).toBe('iron-plate');
      }
    }
  });

  it('does not consume items from invalid pickup sources', () => {
    for (const rotation of DIRECTION_SEQUENCE) {
      const { inserter, sourceBelt, advanceTo } = setupCustomInserterTransferScenario(rotation, 'iron-ore');
      sourceBelt.item = null;

      advanceTo(20);
      expect(inserter.holding).toBeNull();
    }
  });

  it('does not lose held items when destination is blocked and drops when destination clears', () => {
    for (const rotation of DIRECTION_SEQUENCE) {
      for (const item of ['iron-ore', 'iron-plate'] as const) {
        const { inserter, sourceBelt, targetBelt, advanceTo } = setupCustomInserterTransferScenario(rotation, item);

        targetBelt.item = 'iron-plate';
        advanceTo(20);
        expect(inserter.holding).toBe(item);
        expect(sourceBelt.item).toBeNull();

        advanceTo(40);
        expect(inserter.holding).toBe(item);
        expect(sourceBelt.item).toBeNull();
        expect(targetBelt.item).toBe('iron-plate');

        targetBelt.item = null;
        targetBelt.buffer = null;
        targetBelt.items = [null];
        advanceTo(60);

        expect(inserter.holding).toBeNull();
        expect(targetBelt.item).toBe(item);
      }
    }
  });

  it('keeps canonical belt capacity at one item per tile under upstream contention', () => {
    const first = runCanonicalBeltCapacityEdgeScenario();
    const second = runCanonicalBeltCapacityEdgeScenario();

    expect(first).toEqual(second);
    expect(first.tick).toBe(15);
    expect(first.totalItems).toBe(3);
    expect(first.targetItem === 'iron-ore' || first.targetItem === 'iron-plate').toBe(true);
    expect(first.westItem === null && first.southItem === null).toBe(false);
  });

  it('moves canonical belts only on 15-tick cadence and remains frozen while paused', () => {
    const sim = createSim({ width: 8, height: 3, seed: 912 });

    const sourceId = sim.addEntity({ kind: 'belt', pos: { x: 1, y: 1 }, rot: 'E' });
    const targetId = sim.addEntity({ kind: 'belt', pos: { x: 2, y: 1 }, rot: 'E' });

    const source = getState<CanonicalBeltState>(sim, sourceId);
    const target = getState<CanonicalBeltState>(sim, targetId);
    source.item = 'iron-ore';
    source.buffer = source.item;
    source.items = [source.item];

    stepTicks(sim, 14);
    expect(sim.tickCount).toBe(14);
    expect(source).toMatchObject({ tickPhase: 14, item: 'iron-ore' });
    expect(target).toMatchObject({ tickPhase: 14, item: null });

    sim.pause();
    stepTicks(sim, 30);
    expect(sim.tickCount).toBe(14);
    expect(source).toMatchObject({ tickPhase: 14, item: 'iron-ore' });
    expect(target).toMatchObject({ tickPhase: 14, item: null });

    sim.resume();
    stepTicks(sim, 1);
    expect(sim.tickCount).toBe(15);
    expect(source).toMatchObject({ tickPhase: 15, item: null });
    expect(target).toMatchObject({ tickPhase: 15, item: 'iron-ore' });
  });

  it('runs canonical inserter transfer on 20-tick cadence without dup/drop across blocked drops', () => {
    const first = runCanonicalInserterBlockedCadenceScenario();
    const second = runCanonicalInserterBlockedCadenceScenario();

    expect(first).toEqual(second);

    expect(first.tick20).toEqual({
      tick: 20,
      source: null,
      holding: 'iron-ore',
      target: 'iron-plate',
      total: 2,
    });
    expect(first.tick40).toEqual({
      tick: 40,
      source: 'iron-ore',
      holding: 'iron-ore',
      target: 'iron-plate',
      total: 3,
    });
    expect(first.tick79).toEqual({
      tick: 79,
      source: 'iron-ore',
      holding: null,
      target: 'iron-ore',
      total: 2,
    });
    expect(first.tick80).toEqual({
      tick: 80,
      source: null,
      holding: 'iron-ore',
      target: 'iron-ore',
      total: 2,
    });
  });
});
