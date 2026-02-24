import { getDefinition, registerEntity } from "../src/core/registry";
import { createSim } from "../src/core/sim";
import { attachInput } from "../src/ui/input";
import { createPlacementController, type Simulation } from "../src/ui/placement";
import {
  rotateDirection,
  DIRECTION_SEQUENCE,
  DIRECTION_VECTORS,
  OPPOSITE_DIRECTION,
  type Direction,
  type EntityBase,
  type ItemKind,
} from "../src/core/types";
import "../src/entities/all";

let kindCounter = 0;

const nextKind = (prefix: string): string => {
  kindCounter += 1;
  return `${prefix}-${kindCounter}`;
};

const getEntityId = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && value !== null && "id" in value) {
    const { id } = value as { id: unknown };
    if (typeof id === "string") {
      return id;
    }
  }

  throw new Error("Unable to resolve entity id from value");
};

const hasEntityId = (value: unknown, id: string): boolean => {
  if (typeof value !== "object" || value === null || !("id" in value)) {
    return false;
  }

  const { id: entityId } = value as { id: unknown };
  return entityId === id;
};

const getUpdateCount = (value: unknown): number | undefined => {
  if (typeof value !== "object" || value === null || !("state" in value)) {
    return undefined;
  }

  const { state } = value as { state: unknown };
  if (typeof state !== "object" || state === null || !("updates" in state)) {
    return undefined;
  }

  const { updates } = state as { updates: unknown };
  return typeof updates === "number" ? updates : undefined;
};

type WorldEntitySnapshot = {
  id: string;
  kind: string;
  pos: { x: number; y: number };
  rot: Direction;
  state: unknown;
};

const snapshotWorld = (sim: ReturnType<typeof createSim>): WorldEntitySnapshot[] => {
  return sim
    .getAllEntities()
    .map((entity) => ({
      id: entity.id,
      kind: String(entity.kind),
      pos: { x: entity.pos.x, y: entity.pos.y },
      rot: entity.rot,
      state: entity.state === undefined ? undefined : structuredClone(entity.state),
    }))
    .sort((left, right) => Number(left.id) - Number(right.id));
};

const CHAIN_MINER_KIND = "sim-miner-belt-inserter-furnace";
const CHAIN_BELT_KIND = "sim-belt-chain-belt";
const CHAIN_INSERTER_KIND = "sim-belt-chain-inserter";
const CHAIN_FURNACE_KIND = "sim-belt-chain-furnace";
const CHAIN_MINER_ATTEMPTS = 60;
const CHAIN_BELT_ATTEMPTS = 15;
const CHAIN_INSERTER_ATTEMPTS = 20;
const CHAIN_FURNACE_SMELT_TICKS = 180;

let chainCadenceDefinitionsRegistered = false;

type Vector = {
  x: number;
  y: number;
};

type ChainMinerState = {
  ticks: number;
  holding: ItemKind | null;
  attempts: number;
  moved: number;
  blocked: number;
};

type ChainBeltState = {
  ticks: number;
  item: ItemKind | null;
  attempts: number;
  moved: number;
  blocked: number;
};

type ChainInserterState = {
  ticks: number;
  holding: ItemKind | null;
  attempts: number;
  pickups: number;
  drops: number;
  blockedPickups: number;
  blockedDrops: number;
};

type ChainFurnaceState = {
  input: ItemKind | null;
  output: ItemKind | null;
  crafting: boolean;
  progressTicks: number;
  completed: number;
};

type CanonicalBeltState = {
  tickPhase: number;
  item: ItemKind | null;
};

const add = (left: Vector, right: Vector): Vector => ({
  x: left.x + right.x,
  y: left.y + right.y,
});

const findKindAt = (sim: ReturnType<typeof createSim>, pos: Vector, kind: string): EntityBase | undefined => {
  return sim.getEntitiesAt(pos).find((entity) => entity.kind === kind);
};

const offsetFrom = (direction: Direction): Vector => {
  if (direction === "N") return { x: 0, y: -1 };
  if (direction === "S") return { x: 0, y: 1 };
  if (direction === "E") return { x: 1, y: 0 };
  return { x: -1, y: 0 };
};

const asState = <T extends object>(value: unknown): T | undefined => {
  if (typeof value === null || typeof value !== "object") {
    return undefined;
  }

  return value as T;
};

const ensureChainCadenceDefinitions = (): void => {
  if (chainCadenceDefinitionsRegistered) {
    return;
  }

  registerEntity(CHAIN_MINER_KIND, {
    create: () => ({
      ticks: 0,
      holding: "iron-ore" as ItemKind | null,
      attempts: 0,
      moved: 0,
      blocked: 0,
    }),
    update: (entity, _dtMs, sim) => {
      const state = asState<ChainMinerState>(entity.state);
      if (state === undefined) {
        return;
      }

      state.ticks += 1;
      if (state.ticks % CHAIN_MINER_ATTEMPTS !== 0) {
        return;
      }

      if (state.holding === null) {
        state.holding = "iron-ore";
      }

      const ahead = add(entity.pos, offsetFrom(entity.rot));
      const belt = findKindAt(sim, ahead, CHAIN_BELT_KIND);
      const beltState = asState<ChainBeltState>(belt?.state);

      if (!beltState || beltState.item !== null) {
        state.blocked += 1;
        return;
      }

      state.attempts += 1;
      beltState.item = state.holding;
      state.holding = null;
      state.moved += 1;
    },
  });

  registerEntity(CHAIN_BELT_KIND, {
    create: () => ({ ticks: 0, item: null as ItemKind | null, attempts: 0, moved: 0, blocked: 0 }),
    update: (entity, _dtMs, sim) => {
      const state = asState<ChainBeltState>(entity.state);
      if (state === undefined) {
        return;
      }

      state.ticks += 1;
      if (state.ticks % CHAIN_BELT_ATTEMPTS !== 0 || state.item === null) {
        return;
      }

      state.attempts += 1;

      const ahead = add(entity.pos, offsetFrom(entity.rot));
      const inserter = findKindAt(sim, ahead, CHAIN_INSERTER_KIND);
      const inserterState = asState<ChainInserterState>(inserter?.state);

      if (inserterState === undefined || inserterState.holding !== null) {
        state.blocked += 1;
        return;
      }

      inserterState.holding = state.item;
      state.item = null;
      state.moved += 1;
    },
  });

  registerEntity(CHAIN_INSERTER_KIND, {
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
      const state = asState<ChainInserterState>(entity.state);
      if (state === undefined) {
        return;
      }

      state.ticks += 1;
      if (state.ticks % CHAIN_INSERTER_ATTEMPTS !== 0) {
        return;
      }

      state.attempts += 1;

      if (state.holding === null) {
        const source = add(entity.pos, { x: offsetFrom(entity.rot).x * -1, y: offsetFrom(entity.rot).y * -1 });
        const belt = findKindAt(sim, source, CHAIN_BELT_KIND);
        const beltState = asState<ChainBeltState>(belt?.state);

        if (beltState === undefined || beltState.item === null) {
          state.blockedPickups += 1;
          return;
        }

        state.holding = beltState.item;
        beltState.item = null;
        state.pickups += 1;
        return;
      }

      const target = add(entity.pos, offsetFrom(entity.rot));
      const furnace = findKindAt(sim, target, CHAIN_FURNACE_KIND);
      const furnaceState = asState<ChainFurnaceState>(furnace?.state);

      if (
        furnaceState === undefined ||
        furnaceState.input !== null ||
        furnaceState.crafting ||
        furnaceState.output !== null
      ) {
        state.blockedDrops += 1;
        return;
      }

      furnaceState.input = state.holding;
      state.holding = null;
      state.drops += 1;
    },
  });

  registerEntity(CHAIN_FURNACE_KIND, {
    create: () => ({
      input: null as ItemKind | null,
      output: null as ItemKind | null,
      crafting: false,
      progressTicks: 0,
      completed: 0,
    }),
    update: (entity) => {
      const state = asState<ChainFurnaceState>(entity.state);
      if (state === undefined) {
        return;
      }

      if (state.output !== null) {
        return;
      }

      if (!state.crafting) {
        if (state.input !== "iron-ore") {
          return;
        }

        state.input = null;
        state.crafting = true;
        state.progressTicks = 0;
        return;
      }

      if (state.progressTicks < CHAIN_FURNACE_SMELT_TICKS) {
        state.progressTicks += 1;
      }

      if (state.progressTicks < CHAIN_FURNACE_SMELT_TICKS) {
        return;
      }

      state.output = "iron-plate";
      state.crafting = false;
      state.progressTicks = 0;
      state.completed += 1;
    },
  });

  chainCadenceDefinitionsRegistered = true;
};

type Listener = (event: unknown) => void;

const createMockInputStage = () => {
  const listenerMap: Map<string, Set<Listener>> = new Map();

  const on = (event: string, listener: Listener): void => {
    const bucket = listenerMap.get(event);
    if (bucket === undefined) {
      listenerMap.set(event, new Set([listener]));
      return;
    }

    bucket.add(listener);
  };

  const off = (event: string, listener: Listener): void => {
    const bucket = listenerMap.get(event);
    if (bucket === undefined) {
      return;
    }

    bucket.delete(listener);
    if (bucket.size === 0) {
      listenerMap.delete(event);
    }
  };

  const emit = (event: string, payload: unknown): void => {
    const bucket = listenerMap.get(event);
    if (bucket === undefined) {
      return;
    }

    for (const callback of Array.from(bucket)) {
      callback(payload);
    }
  };

  return { on, off, emit };
};

describe("simulation registry and loop", () => {
  test("registers definitions and invokes create during addEntity", () => {
    const kind = nextKind("miner-registry");
    let createCalls = 0;

    const definition = {
      create: () => {
        createCalls += 1;
        return { updates: 0 };
      },
      update: () => {
        // no-op
      },
    };

    registerEntity(kind, definition);

    expect(getDefinition(kind)).toBe(definition);

    const sim = createSim();
    sim.addEntity({ kind, pos: { x: 4, y: 7 } } as Parameters<typeof sim.addEntity>[0]);

    expect(createCalls).toBe(1);
  });

  test("advances fixed-step updates exactly N times for one entity", () => {
    const kind = nextKind("miner-ticking");
    const tickMs = 1000 / 60;
    const steps = 90;
    let updateCalls = 0;

    const definition = {
      create: () => ({ updates: 0 }),
      update: (entity: unknown) => {
        updateCalls += 1;

        if (typeof entity !== "object" || entity === null || !("state" in entity)) {
          throw new Error("Unexpected entity shape passed to update");
        }

        const entityWithState = entity as { state?: { updates?: number } };
        if (!entityWithState.state) {
          entityWithState.state = { updates: 0 };
        }

        const current = entityWithState.state.updates ?? 0;
        entityWithState.state.updates = current + 1;
      },
    };

    registerEntity(kind, definition);

    const sim = createSim();
    const added = sim.addEntity({ kind, pos: { x: 1, y: 1 } } as Parameters<typeof sim.addEntity>[0]);
    const id = getEntityId(added);

    sim.step(steps * tickMs);

    expect(updateCalls).toBe(steps);
    expect(getUpdateCount(sim.getEntityById(id))).toBe(steps);
  });

  test("advances only on fixed-step boundaries with fractional frame times", () => {
    const kind = nextKind("miner-fractional");
    const tickMs = 1000 / 60;
    let updateCalls = 0;

    registerEntity(kind, {
      create: () => ({ updates: 0 }),
      update: (entity: unknown) => {
        updateCalls += 1;

        if (typeof entity !== "object" || entity === null || !("state" in entity)) {
          throw new Error("Unexpected entity shape passed to update");
        }

        const entityWithState = entity as { state?: { updates?: number } };
        if (!entityWithState.state) {
          entityWithState.state = { updates: 0 };
        }

        const current = entityWithState.state.updates ?? 0;
        entityWithState.state.updates = current + 1;
      },
    });

    const sim = createSim();
    sim.addEntity({ kind, pos: { x: 0, y: 0 } } as Parameters<typeof sim.addEntity>[0]);

    sim.step(tickMs / 2);
    expect(updateCalls).toBe(0);
    sim.step(tickMs / 2);
    expect(updateCalls).toBe(1);

    sim.step(tickMs / 4);
    expect(updateCalls).toBe(1);
    sim.step((tickMs * 3) / 4);
    expect(updateCalls).toBe(2);
  });

  test("keeps tickCount and elapsedMs aligned across aggregated fractional steps", () => {
    const kind = nextKind("miner-aggregated-fractional");
    const tickMs = 1000 / 60;

    registerEntity(kind, {
      create: () => ({ updates: 0 }),
      update: (entity: unknown) => {
        if (typeof entity !== "object" || entity === null || !("state" in entity)) {
          throw new Error("Unexpected entity shape passed to update");
        }

        const entityWithState = entity as { state?: { updates?: number } };
        if (!entityWithState.state) {
          entityWithState.state = { updates: 0 };
        }

        entityWithState.state.updates = (entityWithState.state.updates ?? 0) + 1;
      },
    });

    const sim = createSim();
    sim.addEntity({ kind, pos: { x: 0, y: 0 } } as Parameters<typeof sim.addEntity>[0]);

    sim.step(5 * tickMs + tickMs / 2);
    expect(sim.tickCount).toBe(5);
    expect(sim.elapsedMs).toBeCloseTo(5 * tickMs, 6);

    sim.step(tickMs / 2);
    expect(sim.tickCount).toBe(6);
    expect(sim.elapsedMs).toBeCloseTo(6 * tickMs, 6);
  });

  test("advances fixed-step updates deterministically for legacy addEntity(kind, init)", () => {
    const kind = nextKind("miner-compat-fixed");
    const tickMs = 1000 / 60;
    let updateCalls = 0;

    registerEntity(kind, {
      create: () => ({ updates: 0 }),
      update: (entity: unknown) => {
        updateCalls += 1;

        if (typeof entity !== "object" || entity === null || !("state" in entity)) {
          throw new Error("Unexpected entity shape passed to update");
        }

        const entityWithState = entity as { state?: { updates?: number } };
        if (!entityWithState.state) {
          entityWithState.state = { updates: 0 };
        }

        const current = entityWithState.state.updates ?? 0;
        entityWithState.state.updates = current + 1;
      },
    });

    const sim = createSim({ seed: 11, width: 16, height: 16 });
    const id = sim.addEntity(kind, {
      pos: { x: 2, y: 2 },
    });

    const entity = sim.getEntityById(id);
    expect(getUpdateCount(entity)).toBe(0);
    expect(sim.tickCount).toBe(0);

    sim.step(tickMs / 4);
    expect(updateCalls).toBe(0);
    expect(sim.tickCount).toBe(0);

    sim.step(tickMs / 4);
    expect(updateCalls).toBe(0);
    expect(sim.tickCount).toBe(0);

    sim.step(tickMs / 2);
    expect(updateCalls).toBe(1);
    expect(sim.tickCount).toBe(1);
    expect(getUpdateCount(sim.getEntityById(id))).toBe(1);

    sim.step((2 * tickMs) + tickMs / 2);
    expect(updateCalls).toBe(3);
    expect(sim.tickCount).toBe(3);
    expect(sim.elapsedMs).toBeCloseTo(tickMs * 3);
    expect(getUpdateCount(sim.getEntityById(id))).toBe(3);
  });

  test("halts advancement while paused and resumes without dropped or duplicated ticks", () => {
    const kind = nextKind("miner-pause");
    const tickMs = 1000 / 60;
    let updateCalls = 0;

    registerEntity(kind, {
      create: () => ({ updates: 0 }),
      update: () => {
        updateCalls += 1;
      },
    });

    const sim = createSim();
    sim.addEntity({ kind, pos: { x: 2, y: 2 } } as Parameters<typeof sim.addEntity>[0]);

    sim.step(3 * tickMs);
    expect(updateCalls).toBe(3);
    expect(sim.tickCount).toBe(3);

    const tickCountBeforePause = sim.tickCount;
    const elapsedBeforePause = sim.elapsedMs;

    sim.pause();
    sim.step(10 * tickMs);
    sim.step(10 * tickMs);

    expect(updateCalls).toBe(3);
    expect(sim.tickCount).toBe(tickCountBeforePause);
    expect(sim.elapsedMs).toBe(elapsedBeforePause);

    sim.resume();
    sim.step(tickMs / 4);
    expect(sim.tickCount).toBe(tickCountBeforePause);
    expect(sim.elapsedMs).toBe(elapsedBeforePause);
    sim.step((tickMs * 3) / 4);
    expect(sim.tickCount).toBe(tickCountBeforePause + 1);
    expect(updateCalls).toBe(4);
  });

  test("preserves fractional-tick cadence through pause so movement resumes without drift", () => {
    const kind = nextKind("miner-pause-cadence");
    const tickMs = 1000 / 60;

    registerEntity(kind, {
      create: () => ({ updates: 0 }),
      update: (entity: unknown) => {
        if (typeof entity !== "object" || entity === null || !("state" in entity) || !("pos" in entity)) {
          throw new Error("Unexpected entity shape passed to update");
        }

        const entityWithState = entity as {
          state?: { updates?: number };
          pos: { x: number; y: number };
        };
        const updates = (entityWithState.state?.updates ?? 0) + 1;
        entityWithState.state = { ...(entityWithState.state ?? {}), updates };
        entityWithState.pos.x += 1;
      },
    });

    const runWithoutPause = (): {
      tickCount: number;
      elapsedMs: number;
      world: WorldEntitySnapshot[];
    } => {
      const sim = createSim({ seed: 9 });
      sim.addEntity({ kind, pos: { x: 0, y: 0 } } as Parameters<typeof sim.addEntity>[0]);

      sim.step(tickMs / 2);
      sim.step(tickMs / 2);

      return {
        tickCount: sim.tickCount,
        elapsedMs: sim.elapsedMs,
        world: snapshotWorld(sim),
      };
    };

    const runWithPause = (): {
      tickCount: number;
      elapsedMs: number;
      world: WorldEntitySnapshot[];
    } => {
      const sim = createSim({ seed: 9 });
      sim.addEntity({ kind, pos: { x: 0, y: 0 } } as Parameters<typeof sim.addEntity>[0]);

      sim.step(tickMs / 2);
      sim.pause();
      sim.step(5 * tickMs);
      sim.resume();
      sim.step(tickMs / 2);

      return {
        tickCount: sim.tickCount,
        elapsedMs: sim.elapsedMs,
        world: snapshotWorld(sim),
      };
    };

    const unpaused = runWithoutPause();
    const paused = runWithPause();

    expect(unpaused).toEqual(paused);
    expect(unpaused.tickCount).toBe(1);
    expect(unpaused.world[0]?.pos).toEqual({ x: 1, y: 0 });
  });

  test("produces identical ticks and world state for equal active elapsed time across chunk patterns", () => {
    const kind = nextKind("miner-chunk-equivalence");
    const tickMs = 1000 / 60;

    registerEntity(kind, {
      create: () => ({ updates: 0, checksum: 0 }),
      update: (entity: unknown) => {
        if (
          typeof entity !== "object" ||
          entity === null ||
          !("state" in entity) ||
          !("pos" in entity)
        ) {
          throw new Error("Unexpected entity shape passed to update");
        }

        const entityWithState = entity as {
          state?: { updates?: number; checksum?: number };
          pos: { x: number; y: number };
        };
        if (!entityWithState.state) {
          entityWithState.state = { updates: 0, checksum: 0 };
        }

        const updates = (entityWithState.state.updates ?? 0) + 1;
        entityWithState.state.updates = updates;

        if (updates % 2 === 0) {
          entityWithState.pos.x += 1;
        }
        if (updates % 3 === 0) {
          entityWithState.pos.y += 1;
        }

        const checksumBase = entityWithState.state.checksum ?? 0;
        entityWithState.state.checksum =
          checksumBase +
          entityWithState.pos.x * 31 +
          entityWithState.pos.y * 17 +
          updates;
      },
    });

    const runScenario = (
      chunkFractionsInEighths: number[],
    ): {
      tickCount: number;
      elapsedMs: number;
      world: WorldEntitySnapshot[];
      updatesById: [number | undefined, number | undefined];
    } => {
      const sim = createSim({ width: 32, height: 32, seed: 42 });
      const firstId = sim.addEntity({ kind, pos: { x: 1, y: 1 }, rot: "E" });
      const secondId = sim.addEntity({ kind, pos: { x: 3, y: 2 }, rot: "S" });

      for (const fraction of chunkFractionsInEighths) {
        sim.step((fraction * tickMs) / 8);
      }

      return {
        tickCount: sim.tickCount,
        elapsedMs: sim.elapsedMs,
        world: snapshotWorld(sim),
        updatesById: [
          getUpdateCount(sim.getEntityById(firstId)),
          getUpdateCount(sim.getEntityById(secondId)),
        ],
      };
    };

    const singleChunk = runScenario([52]);
    const irregularChunks = runScenario([3, 5, 9, 7, 12, 16]);
    const fineGrainedChunks = runScenario([1, 1, 2, 4, 8, 16, 20]);

    expect(singleChunk.tickCount).toBe(6);
    expect(singleChunk.elapsedMs).toBeCloseTo(6 * tickMs);
    expect(singleChunk.updatesById).toEqual([6, 6]);
    expect(irregularChunks).toEqual(singleChunk);
    expect(fineGrainedChunks).toEqual(singleChunk);
  });

  test("keeps exact 60 TPS tick cadence deterministic across repeated chunking patterns", () => {
    const kind = nextKind("miner-cadence-repeatability");
    const tickMs = 1000 / 60;

    registerEntity(kind, {
      create: () => ({ updates: 0, checksum: 0 }),
      update: (entity: unknown) => {
        if (typeof entity !== "object" || entity === null || !("state" in entity) || !("pos" in entity)) {
          throw new Error("Unexpected entity shape passed to update");
        }

        const typedEntity = entity as {
          state?: { updates?: number; checksum?: number };
          pos: { x: number; y: number };
        };
        if (typedEntity.state === undefined) {
          typedEntity.state = { updates: 0, checksum: 0 };
        }

        const updates = (typedEntity.state.updates ?? 0) + 1;
        typedEntity.state.updates = updates;
        if (updates % 4 === 0) {
          typedEntity.pos.x += 1;
        }
        typedEntity.state.checksum = (typedEntity.state.checksum ?? 0) + updates * 7 + typedEntity.pos.x * 13;
      },
    });

    const runScenario = (
      chunkFractionsInTwelfths: number[],
    ): { tickCount: number; elapsedMs: number; world: WorldEntitySnapshot[] } => {
      const sim = createSim({ width: 24, height: 24, seed: 77 });
      sim.addEntity({ kind, pos: { x: 1, y: 1 } } as Parameters<typeof sim.addEntity>[0]);

      for (const fraction of chunkFractionsInTwelfths) {
        sim.step((fraction * tickMs) / 12);
      }

      return {
        tickCount: sim.tickCount,
        elapsedMs: sim.elapsedMs,
        world: snapshotWorld(sim),
      };
    };

    const baseline = runScenario([720]);
    expect(baseline.tickCount).toBe(60);
    expect(baseline.elapsedMs).toBeCloseTo(60 * tickMs, 6);

    const chunked = runScenario([7, 11, 13, 19, 23, 29, 31, 37, 41, 47, 53, 409]);
    expect(chunked).toEqual(baseline);

    for (let run = 0; run < 5; run += 1) {
      expect(runScenario([5, 7, 9, 11, 13, 17, 19, 23, 616])).toEqual(baseline);
    }
  });

  test("resolves sim-level movement contention deterministically from stable position ordering", () => {
    const tickMs = 1000 / 60;
    const kind = nextKind("sim-contender");

    registerEntity(kind, {
      create: () => ({}),
      update: (entity: unknown, _dtMs: number, sim) => {
        if (typeof entity !== "object" || entity === null || !("id" in entity) || !("pos" in entity)) {
          throw new Error("Unexpected entity shape passed to update");
        }

        const typedEntity = entity as {
          id: string;
          pos: { x: number; y: number };
        };
        const target = { x: 1, y: typedEntity.pos.y };
        const destinationOccupied = (sim.getEntitiesAt?.(target) ?? []).some((candidate) => candidate.id !== typedEntity.id);
        if (!destinationOccupied) {
          typedEntity.pos = target;
        }
      },
    });

    const runScenario = (leftFirst: boolean): { left: { x: number; y: number }; right: { x: number; y: number } } => {
      const sim = createSim({ width: 4, height: 4, seed: 3 });
      let leftId: string;
      let rightId: string;

      if (leftFirst) {
        leftId = sim.addEntity({ kind, pos: { x: 1, y: 0 } } as Parameters<typeof sim.addEntity>[0]);
        rightId = sim.addEntity({ kind, pos: { x: 2, y: 0 } } as Parameters<typeof sim.addEntity>[0]);
      } else {
        rightId = sim.addEntity({ kind, pos: { x: 2, y: 0 } } as Parameters<typeof sim.addEntity>[0]);
        leftId = sim.addEntity({ kind, pos: { x: 1, y: 0 } } as Parameters<typeof sim.addEntity>[0]);
      }

      sim.step(tickMs);

      const leftEntity = sim.getEntityById(leftId);
      const rightEntity = sim.getEntityById(rightId);
      if (leftEntity === undefined || rightEntity === undefined) {
        throw new Error("Expected entities to exist after creation");
      }

      return {
        left: { x: leftEntity.pos.x, y: leftEntity.pos.y },
        right: { x: rightEntity.pos.x, y: rightEntity.pos.y },
      };
    };

    const leftFirst = runScenario(true);
    const rightFirst = runScenario(false);

    expect(leftFirst.left).toEqual({ x: 1, y: 0 });
    expect(leftFirst.right).toEqual({ x: 2, y: 0 });
    expect(rightFirst).toEqual(leftFirst);
  });

  test("keeps paused intervals mutation-free and resumes from pre-pause state with deterministic remainder handling", () => {
    const kind = nextKind("miner-pause-remainder");
    const tickMs = 1000 / 60;

    registerEntity(kind, {
      create: () => ({ updates: 0 }),
      update: (entity: unknown) => {
        if (typeof entity !== "object" || entity === null || !("state" in entity)) {
          throw new Error("Unexpected entity shape passed to update");
        }

        const entityWithState = entity as { state?: { updates?: number } };
        if (!entityWithState.state) {
          entityWithState.state = { updates: 0 };
        }

        const current = entityWithState.state.updates ?? 0;
        entityWithState.state.updates = current + 1;
      },
    });

    const sim = createSim();
    const id = sim.addEntity({ kind, pos: { x: 2, y: 2 } } as Parameters<typeof sim.addEntity>[0]);

    sim.step(2 * tickMs + tickMs / 2);
    expect(sim.tickCount).toBe(2);
    const updatesBeforePause = getUpdateCount(sim.getEntityById(id));
    if (updatesBeforePause === undefined) {
      throw new Error("Expected update state to exist before pause");
    }
    expect(updatesBeforePause).toBe(2);

    const snapshotBeforePause = {
      tickCount: sim.tickCount,
      elapsedMs: sim.elapsedMs,
      world: snapshotWorld(sim),
    };

    sim.pause();
    sim.step(9 * tickMs);
    sim.step(tickMs / 3);
    sim.step((7 * tickMs) / 4);
    expect(sim.tickCount).toBe(snapshotBeforePause.tickCount);
    expect(sim.elapsedMs).toBe(snapshotBeforePause.elapsedMs);
    expect(snapshotWorld(sim)).toEqual(snapshotBeforePause.world);

    sim.resume();
    sim.step(tickMs / 2);
    expect(sim.tickCount).toBe(snapshotBeforePause.tickCount + 1);
    expect(sim.elapsedMs).toBeCloseTo(snapshotBeforePause.elapsedMs + tickMs);
    expect(snapshotWorld(sim)).not.toEqual(snapshotBeforePause.world);
    expect(getUpdateCount(sim.getEntityById(id))).toBe(updatesBeforePause + 1);

    sim.step(tickMs + tickMs / 2);
    expect(sim.tickCount).toBe(snapshotBeforePause.tickCount + 2);
    expect(sim.elapsedMs).toBeCloseTo(snapshotBeforePause.elapsedMs + tickMs * 2);
    expect(getUpdateCount(sim.getEntityById(id))).toBe(updatesBeforePause + 2);

    sim.step(tickMs / 2);
    expect(sim.tickCount).toBe(snapshotBeforePause.tickCount + 3);
    expect(sim.elapsedMs).toBeCloseTo(snapshotBeforePause.elapsedMs + tickMs * 3);
    expect(getUpdateCount(sim.getEntityById(id))).toBe(updatesBeforePause + 3);
  });

  test("maintains identical post-resume state across repeated pause/resume boundary runs", () => {
    const kind = nextKind("miner-pause-resume-repeatability");
    const tickMs = 1000 / 60;

    registerEntity(kind, {
      create: () => ({ updates: 0 }),
      update: (entity: unknown) => {
        if (typeof entity !== "object" || entity === null || !("state" in entity) || !("pos" in entity)) {
          throw new Error("Unexpected entity shape passed to update");
        }

        const typedEntity = entity as {
          state?: { updates?: number };
          pos: { x: number; y: number };
        };
        const updates = (typedEntity.state?.updates ?? 0) + 1;
        typedEntity.state = { ...(typedEntity.state ?? {}), updates };
        if (updates % 2 === 0) {
          typedEntity.pos.y += 1;
        }
      },
    });

    const runScenario = (): {
      tickCount: number;
      elapsedMs: number;
      beforePause: WorldEntitySnapshot[];
      duringPause: WorldEntitySnapshot[];
      afterResume: WorldEntitySnapshot[];
    } => {
      const sim = createSim({ width: 16, height: 16, seed: 81 });
      sim.addEntity({ kind, pos: { x: 1, y: 1 } } as Parameters<typeof sim.addEntity>[0]);

      sim.step(tickMs * 4 + tickMs / 2);
      const beforePause = snapshotWorld(sim);
      const beforeTick = sim.tickCount;
      const beforeElapsed = sim.elapsedMs;

      sim.pause();
      sim.step(tickMs * 30);
      sim.step(tickMs / 5);
      const duringPause = snapshotWorld(sim);
      expect(sim.tickCount).toBe(beforeTick);
      expect(sim.elapsedMs).toBe(beforeElapsed);
      expect(duringPause).toEqual(beforePause);

      sim.resume();
      sim.step(tickMs / 2);
      sim.step(3 * tickMs);

      return {
        tickCount: sim.tickCount,
        elapsedMs: sim.elapsedMs,
        beforePause,
        duringPause,
        afterResume: snapshotWorld(sim),
      };
    };

    const first = runScenario();
    const second = runScenario();
    const third = runScenario();

    expect(first).toEqual(second);
    expect(first).toEqual(third);
    expect(first.tickCount).toBe(8);
    expect(first.elapsedMs).toBeCloseTo(8 * tickMs, 6);
  });

  test("enforces exact miner->belt->inserter->furnace cadence at 60/20/15/180 checkpoints", () => {
    ensureChainCadenceDefinitions();

    const sim = createSim({ width: 10, height: 3, seed: 15 });

    const minerId = sim.addEntity({ kind: CHAIN_MINER_KIND, pos: { x: 1, y: 1 }, rot: "E" });
    const beltId = sim.addEntity({ kind: CHAIN_BELT_KIND, pos: { x: 2, y: 1 }, rot: "E" });
    const inserterId = sim.addEntity({ kind: CHAIN_INSERTER_KIND, pos: { x: 3, y: 1 }, rot: "E" });
    const furnaceId = sim.addEntity({ kind: CHAIN_FURNACE_KIND, pos: { x: 4, y: 1 }, rot: "E" });

    const miner = sim.getEntityById(minerId);
    const belt = sim.getEntityById(beltId);
    const inserter = sim.getEntityById(inserterId);
    const furnace = sim.getEntityById(furnaceId);

    if (miner?.state === undefined || belt?.state === undefined || inserter?.state === undefined || furnace?.state === undefined) {
      throw new Error("Expected all cadence entities to have states");
    }

    const minerState = asState<ChainMinerState>(miner.state);
    const beltState = asState<ChainBeltState>(belt.state);
    const inserterState = asState<ChainInserterState>(inserter.state);
    const furnaceState = asState<ChainFurnaceState>(furnace.state);

    if (
      minerState === undefined ||
      beltState === undefined ||
      inserterState === undefined ||
      furnaceState === undefined
    ) {
      throw new Error("Expected typed entity states for cadence-chain entities");
    }

    let tick = 0;
    const advanceTo = (targetTick: number): void => {
      if (targetTick < tick) {
        throw new Error(`advanceTo target ${targetTick} is before current tick ${tick}`);
      }

      for (let i = 0; i < targetTick - tick; i += 1) {
        sim.step(1000 / 60);
      }

      tick = targetTick;
    };

    advanceTo(14);
    expect(tick).toBe(14);
    expect(minerState).toMatchObject({ ticks: 14, holding: "iron-ore", moved: 0, attempts: 0 });
    expect(beltState).toMatchObject({ ticks: 14, item: null, moved: 0 });
    expect(inserterState).toMatchObject({ ticks: 14, holding: null, attempts: 0, pickups: 0, drops: 0 });
    expect(furnaceState).toMatchObject({ input: null, output: null, crafting: false, progressTicks: 0, completed: 0 });

    advanceTo(20);
    expect(tick).toBe(20);
    expect(inserterState).toMatchObject({ attempts: 1, holding: null });

    advanceTo(59);
    expect(tick).toBe(59);
    expect(minerState).toMatchObject({ attempts: 0, moved: 0 });
    expect(beltState.item).toBeNull();
    expect(furnaceState.crafting).toBe(false);

    advanceTo(60);
    expect(tick).toBe(60);
    expect(minerState).toMatchObject({ attempts: 1, moved: 1 });
    expect(beltState).toMatchObject({ item: null, moved: 1 });
    expect(inserterState).toMatchObject({ attempts: 3, pickups: 0, drops: 1, holding: null });
    expect(furnaceState).toMatchObject({ crafting: true, completed: 0, progressTicks: 0, input: null, output: null });

    advanceTo(61);
    expect(tick).toBe(61);
    expect(furnaceState).toMatchObject({ crafting: true, progressTicks: 1, output: null });

    advanceTo(239);
    expect(tick).toBe(239);
    expect(furnaceState).toMatchObject({ crafting: true, progressTicks: 179, output: null, completed: 0 });

    advanceTo(240);
    expect(tick).toBe(240);
    expect(furnaceState).toMatchObject({ crafting: false, output: "iron-plate", progressTicks: 0, completed: 1 });

    advanceTo(241);
    expect(tick).toBe(241);
    expect(furnaceState).toMatchObject({ crafting: false, output: "iron-plate", completed: 1 });
  });

  test("relays custom chain payload on first shared cadence boundary deterministically", () => {
    const sourceKind = nextKind("pipeline-source-regression");
    const middleKind = nextKind("pipeline-middle-regression");
    const sinkKind = nextKind("pipeline-sink-regression");
    const cadence = CHAIN_BELT_ATTEMPTS;

    type PipelineSourceState = {
      ticks: number;
      holding: ItemKind | null;
      moved: number;
    };

    type PipelineMiddleState = {
      ticks: number;
      holding: ItemKind | null;
      relayed: number;
    };

    type PipelineSinkState = {
      ticks: number;
      holding: ItemKind | null;
      received: number;
    };

    registerEntity(sourceKind, {
      create: () => ({
        ticks: 0,
        holding: "iron-ore" as ItemKind | null,
        moved: 0,
      }),
      update: (entity, _dtMs, sim) => {
        const state = asState<PipelineSourceState>(entity.state);
        if (state === undefined) {
          return;
        }

        state.ticks += 1;
        if (state.ticks % cadence !== 0) {
          return;
        }

        if (state.holding === null) {
          return;
        }

        const destination = add(entity.pos, offsetFrom(entity.rot));
        const middle = findKindAt(sim, destination, middleKind);
        const middleState = asState<PipelineMiddleState>(middle?.state);
        if (middleState === undefined || middleState.holding !== null) {
          return;
        }

        middleState.holding = state.holding;
        state.holding = null;
        state.moved += 1;
      },
    });

    registerEntity(middleKind, {
      create: () => ({
        ticks: 0,
        holding: null as ItemKind | null,
        relayed: 0,
      }),
      update: (entity, _dtMs, sim) => {
        const state = asState<PipelineMiddleState>(entity.state);
        if (state === undefined) {
          return;
        }

        state.ticks += 1;
        if (state.ticks % cadence !== 0) {
          return;
        }

        if (state.holding === null) {
          return;
        }

        const destination = add(entity.pos, offsetFrom(entity.rot));
        const sink = findKindAt(sim, destination, sinkKind);
        const sinkState = asState<PipelineSinkState>(sink?.state);

        if (sinkState === undefined || sinkState.holding !== null) {
          return;
        }

        sinkState.holding = state.holding;
        state.holding = null;
        state.relayed += 1;
      },
    });

    registerEntity(sinkKind, {
      create: () => ({
        ticks: 0,
        holding: null as ItemKind | null,
        received: 0,
      }),
      update: (entity) => {
        const state = asState<PipelineSinkState>(entity.state);
        if (state === undefined) {
          return;
        }

        state.ticks += 1;
      },
    });

    const sim = createSim({ width: 10, height: 3, seed: 33 });
    const sourceId = sim.addEntity({ kind: sourceKind, pos: { x: 1, y: 1 }, rot: "E" });
    const middleId = sim.addEntity({ kind: middleKind, pos: { x: 2, y: 1 }, rot: "E" });
    const sinkId = sim.addEntity({ kind: sinkKind, pos: { x: 3, y: 1 }, rot: "E" });

    const sourceEntity = sim.getEntityById(sourceId);
    const middleEntity = sim.getEntityById(middleId);
    const sinkEntity = sim.getEntityById(sinkId);

    if (sourceEntity?.state === undefined || middleEntity?.state === undefined || sinkEntity?.state === undefined) {
      throw new Error("Expected all pipeline entities to have states");
    }

    const sourceState = asState<PipelineSourceState>(sourceEntity.state);
    const middleState = asState<PipelineMiddleState>(middleEntity.state);
    const sinkState = asState<PipelineSinkState>(sinkEntity.state);

    if (sourceState === undefined || middleState === undefined || sinkState === undefined) {
      throw new Error("Expected pipeline entity states to be typed");
    }

    const tickMs = 1000 / 60;
    const stepTicks = (ticks: number): void => {
      for (let i = 0; i < ticks; i += 1) {
        sim.step(tickMs);
      }
    };

    stepTicks(14);
    expect(sim.tickCount).toBe(14);
    expect(sourceState).toMatchObject({
      ticks: 14,
      holding: "iron-ore",
      moved: 0,
    });
    expect(middleState).toMatchObject({
      ticks: 14,
      holding: null,
      relayed: 0,
    });
    expect(sinkState).toMatchObject({
      ticks: 14,
      holding: null,
      received: 0,
    });

    stepTicks(1);
    expect(sim.tickCount).toBe(15);
    expect(sourceState).toMatchObject({
      ticks: 15,
      holding: null,
      moved: 1,
    });
    expect(middleState).toMatchObject({
      ticks: 15,
      holding: null,
      relayed: 1,
    });
    expect(sinkState).toMatchObject({
      ticks: 15,
      holding: "iron-ore",
      received: 0,
    });
  });

  test("halts chain movement during pause and preserves cadence phase offsets on resume", () => {
    ensureChainCadenceDefinitions();

    const runScenario = (withPause: boolean): string => {
      const sim = createSim({ width: 10, height: 3, seed: 16 });
      const minerId = sim.addEntity({ kind: CHAIN_MINER_KIND, pos: { x: 1, y: 1 }, rot: "E" });
      const beltId = sim.addEntity({ kind: CHAIN_BELT_KIND, pos: { x: 2, y: 1 }, rot: "E" });
      const inserterId = sim.addEntity({ kind: CHAIN_INSERTER_KIND, pos: { x: 3, y: 1 }, rot: "E" });
      const furnaceId = sim.addEntity({ kind: CHAIN_FURNACE_KIND, pos: { x: 4, y: 1 }, rot: "E" });

      const miner = sim.getEntityById(minerId);
      const belt = sim.getEntityById(beltId);
      const inserter = sim.getEntityById(inserterId);
      const furnace = sim.getEntityById(furnaceId);

      if (miner?.state === undefined || belt?.state === undefined || inserter?.state === undefined || furnace?.state === undefined) {
        throw new Error("Expected all cadence entities to have states");
      }

      const tickStates: Array<{
        tick: number;
        miner: ChainMinerState;
        belt: ChainBeltState;
        inserter: ChainInserterState;
        furnace: ChainFurnaceState;
      }> = [];

      const currentSnapshot = (tick: number): {
        tick: number;
        miner: ChainMinerState;
        belt: ChainBeltState;
        inserter: ChainInserterState;
        furnace: ChainFurnaceState;
      } => {
        const minerState = asState<ChainMinerState>(miner.state);
        const beltState = asState<ChainBeltState>(belt.state);
        const inserterState = asState<ChainInserterState>(inserter.state);
        const furnaceState = asState<ChainFurnaceState>(furnace.state);

        if (
          minerState === undefined ||
          beltState === undefined ||
          inserterState === undefined ||
          furnaceState === undefined
        ) {
          throw new Error("Expected typed entity states for cadence-chain entities");
        }

        return {
          tick,
          miner: { ...minerState },
          belt: { ...beltState },
          inserter: { ...inserterState },
          furnace: { ...furnaceState },
        };
      };

      const addSnapshot = (tick: number): void => {
        tickStates.push(currentSnapshot(tick));
      };

      const tickMs = 1000 / 60;
      const stepTicks = (ticks: number): void => {
        for (let i = 0; i < ticks; i += 1) {
          sim.step(tickMs);
        }
      };

      stepTicks(59);
      addSnapshot(59);

      if (withPause) {
        const pausedReference = JSON.stringify(currentSnapshot(59));

        sim.pause();
        stepTicks(45);
        sim.resume();
        const pausedState = JSON.stringify(currentSnapshot(59));

        expect(pausedState).toBe(pausedReference);
      }

      stepTicks(181);
      addSnapshot(240);
      stepTicks(1);
      addSnapshot(241);

      return JSON.stringify(tickStates);
    };

    expect(runScenario(true)).toBe(runScenario(false));
  });

  test("prioritizes canonical belt outbound transfer over same-tick inbound contention", () => {
    const sim = createSim({ width: 10, height: 3, seed: 305 });

    const westSourceId = sim.addEntity({ kind: "belt", pos: { x: 1, y: 1 }, rot: "E" });
    const forwardingId = sim.addEntity({ kind: "belt", pos: { x: 2, y: 1 }, rot: "E" });
    const sinkId = sim.addEntity({ kind: "belt", pos: { x: 3, y: 1 }, rot: "E" });
    const southSourceId = sim.addEntity({ kind: "belt", pos: { x: 2, y: 2 }, rot: "N" });

    const westSource = sim.getEntityById(westSourceId);
    const forwarding = sim.getEntityById(forwardingId);
    const sink = sim.getEntityById(sinkId);
    const southSource = sim.getEntityById(southSourceId);

    if (westSource?.state === undefined || forwarding?.state === undefined || sink?.state === undefined || southSource?.state === undefined) {
      throw new Error("Expected all canonical belt entities to have states");
    }

    const westState = asState<CanonicalBeltState>(westSource.state);
    const forwardingState = asState<CanonicalBeltState>(forwarding.state);
    const sinkState = asState<CanonicalBeltState>(sink.state);
    const southState = asState<CanonicalBeltState>(southSource.state);

    if (westState === undefined || forwardingState === undefined || sinkState === undefined || southState === undefined) {
      throw new Error("Expected typed canonical belt states");
    }

    westState.item = "iron-ore";
    forwardingState.item = "iron-plate";
    southState.item = "iron-ore";

    sim.step((1000 / 60) * 15);

    expect(westState).toMatchObject({ item: "iron-ore", tickPhase: 15 });
    expect(southState).toMatchObject({ item: "iron-ore", tickPhase: 15 });
    expect(forwardingState).toMatchObject({ item: null, tickPhase: 15 });
    expect(sinkState).toMatchObject({ item: "iron-plate", tickPhase: 15 });

    sim.step((1000 / 60) * 15);

    expect(westState).toMatchObject({ item: null, tickPhase: 30 });
    expect(southState).toMatchObject({ item: "iron-ore", tickPhase: 30 });
    expect(forwardingState).toMatchObject({ item: "iron-ore", tickPhase: 30 });
    expect(sinkState).toMatchObject({ item: "iron-plate", tickPhase: 30 });
  });

  test("tracks add/remove bookkeeping and handles missing removals", () => {
    const kind = nextKind("miner-bookkeeping");

    registerEntity(kind, {
      create: () => ({ updates: 0 }),
      update: () => {
        // no-op
      },
    });

    const sim = createSim();
    const pos = { x: 9, y: 3 };
    const added = sim.addEntity({ kind, pos } as Parameters<typeof sim.addEntity>[0]);
    const id = getEntityId(added);

    expect(sim.getEntityById(id)).toBeDefined();
    expect(sim.getEntitiesAt(pos).some((entity) => hasEntityId(entity, id))).toBe(true);

    expect(sim.removeEntity(id)).toBe(true);
    expect(sim.getEntityById(id)).toBeUndefined();
    expect(sim.getEntitiesAt(pos).some((entity) => hasEntityId(entity, id))).toBe(false);

    expect(sim.removeEntity("does-not-exist")).toBe(false);
  });

  test("rotates directions in canonical N->E->S->W->N order", () => {
    const directionSequence: Direction[] = [];
    let current: Direction = "N";

    for (let i = 0; i < DIRECTION_SEQUENCE.length; i += 1) {
      directionSequence.push(current);
      current = rotateDirection(current);
    }

    directionSequence.push(current);
    expect(directionSequence).toEqual([...DIRECTION_SEQUENCE, "N"]);
  });

  test("normalizes arbitrary rotateDirection step counts (including negative)", () => {
    expect(rotateDirection("N", 0)).toBe("N");
    expect(rotateDirection("N", 4)).toBe("N");
    expect(rotateDirection("E", 6)).toBe("W");
    expect(rotateDirection("W", -1)).toBe("S");
    expect(rotateDirection("S", -5)).toBe("E");
  });

  test("keeps direction vector and side-mapping helpers consistent for all four orientations", () => {
    for (let i = 0; i < DIRECTION_SEQUENCE.length; i += 1) {
      const facing = DIRECTION_SEQUENCE[i];
      const right = DIRECTION_SEQUENCE[(i + 1) % DIRECTION_SEQUENCE.length];
      const back = DIRECTION_SEQUENCE[(i + 2) % DIRECTION_SEQUENCE.length];
      const left = DIRECTION_SEQUENCE[(i + 3) % DIRECTION_SEQUENCE.length];

      expect(rotateDirection(facing, 1)).toBe(right);
      expect(rotateDirection(facing, 2)).toBe(back);
      expect(rotateDirection(facing, -1)).toBe(left);
      expect(OPPOSITE_DIRECTION[facing]).toBe(back);

      const frontVector = DIRECTION_VECTORS[facing];
      const rightVector = DIRECTION_VECTORS[right];
      const backVector = DIRECTION_VECTORS[back];
      const leftVector = DIRECTION_VECTORS[left];

      expect(frontVector.x + backVector.x).toBe(0);
      expect(frontVector.y + backVector.y).toBe(0);
      expect(rightVector.x + leftVector.x).toBe(0);
      expect(rightVector.y + leftVector.y).toBe(0);
      expect(Math.abs(frontVector.x * rightVector.x + frontVector.y * rightVector.y)).toBe(0);
    }
  });

  test("keeps 60 TPS phase order stable across chunk patterns and pause/resume invariance", () => {
    const tickMs = 1000 / 60;
    const orderedPhases = ["miner", "belt", "furnace", "inserter", "unphased"] as const;
    type PhaseLabel = (typeof orderedPhases)[number];
    type TraceEvent = { tick: number; phase: PhaseLabel };

    const runScenario = (chunkFractionsInTwelfths: number[]): {
      trace: TraceEvent[];
      tickCount: number;
      elapsedMs: number;
      world: Array<{ id: string; pos: { x: number; y: number }; rot: Direction; updates: number }>;
    } => {
      const trace: TraceEvent[] = [];
      const sim = createSim({ width: 8, height: 8, seed: 91 });
      const kinds: Record<PhaseLabel, string> = {
        miner: nextKind("phase-order-miner"),
        belt: nextKind("phase-order-belt"),
        furnace: nextKind("phase-order-furnace"),
        inserter: nextKind("phase-order-inserter"),
        unphased: nextKind("phase-order-unphased"),
      };

      const registerPhaseProbe = (
        phase: PhaseLabel,
        tickPhase?: "miner" | "belt" | "furnace" | "inserter",
      ): void => {
        registerEntity(kinds[phase], {
          ...(tickPhase === undefined ? {} : { tickPhase }),
          create: () => ({ updates: 0 }),
          update: (entity: EntityBase, _dtMs: number, context: { tick: number }) => {
            const state = entity.state as { updates?: number } | undefined;
            entity.state = { updates: (state?.updates ?? 0) + 1 };
            trace.push({ tick: context.tick, phase });
          },
        });
      };

      registerPhaseProbe("miner", "miner");
      registerPhaseProbe("belt", "belt");
      registerPhaseProbe("furnace", "furnace");
      registerPhaseProbe("inserter", "inserter");
      registerPhaseProbe("unphased");

      sim.addEntity({ kind: kinds.unphased, pos: { x: 0, y: 0 } });
      sim.addEntity({ kind: kinds.inserter, pos: { x: 1, y: 0 } });
      sim.addEntity({ kind: kinds.furnace, pos: { x: 2, y: 0 } });
      sim.addEntity({ kind: kinds.belt, pos: { x: 3, y: 0 } });
      sim.addEntity({ kind: kinds.miner, pos: { x: 4, y: 0 } });

      for (const fraction of chunkFractionsInTwelfths) {
        sim.step((fraction * tickMs) / 12);
      }

      const beforePause = {
        tickCount: sim.tickCount,
        elapsedMs: sim.elapsedMs,
        world: snapshotWorld(sim),
        traceLength: trace.length,
      };
      sim.pause();
      sim.step(11 * tickMs);
      sim.step(tickMs / 3);
      expect(sim.tickCount).toBe(beforePause.tickCount);
      expect(sim.elapsedMs).toBe(beforePause.elapsedMs);
      expect(snapshotWorld(sim)).toEqual(beforePause.world);
      expect(trace).toHaveLength(beforePause.traceLength);

      sim.resume();
      sim.step(tickMs);

      return {
        trace,
        tickCount: sim.tickCount,
        elapsedMs: sim.elapsedMs,
        world: sim
          .getAllEntities()
          .map((entity) => ({
            id: entity.id,
            pos: { x: entity.pos.x, y: entity.pos.y },
            rot: entity.rot,
            updates:
              typeof entity.state === "object" &&
              entity.state !== null &&
              "updates" in entity.state &&
              typeof (entity.state as { updates?: unknown }).updates === "number"
                ? ((entity.state as { updates: number }).updates ?? 0)
                : 0,
          }))
          .sort((left, right) => Number(left.id) - Number(right.id)),
      };
    };

    const baseline = runScenario([720]);
    const chunked = runScenario([7, 11, 13, 19, 23, 29, 31, 37, 41, 47, 53, 409]);
    const repeated = runScenario([5, 7, 9, 11, 13, 17, 19, 23, 616]);

    expect(chunked).toEqual(baseline);
    expect(repeated).toEqual(baseline);
    expect(baseline.tickCount).toBe(61);
    expect(baseline.elapsedMs).toBeCloseTo(61 * tickMs, 6);
    expect(baseline.trace).toHaveLength(61 * orderedPhases.length);

    for (let tick = 0; tick < 61; tick += 1) {
      const phases = baseline.trace
        .filter((event) => event.tick === tick)
        .map((event) => event.phase);
      expect(phases).toEqual(orderedPhases);
    }
  });

  test("applies one deterministic rotation step per R key action", () => {
    const kind = nextKind("miner-rotate-input");
    registerEntity(kind, {
      create: () => ({}),
      update: () => {
        // no-op
      },
    });

    const sim = createSim();
    const minerId = sim.addEntity({
      kind,
      pos: { x: 1, y: 1 },
      rot: "N",
    });
    const entity = sim.getEntityById(minerId) as { rot: Direction };

    const stage = createMockInputStage();
    const controller = attachInput({
      app: {},
      stage,
      metrics: { tileSize: 16, gridSize: { cols: 8, rows: 8 } },
    });

    const detachRotate = controller.onRotate(() => {
      entity.rot = rotateDirection(entity.rot);
    });

    stage.emit("keydown", { code: "KeyR", repeat: false });
    stage.emit("keydown", { code: "KeyR", repeat: true });
    stage.emit("keydown", { key: "r", repeat: false });

    expect(entity.rot).toBe("S");

    detachRotate();
    stage.emit("keydown", { code: "KeyR", repeat: false });
    expect(entity.rot).toBe("S");

    controller.destroy();
  });

  test("cycles rotation in exact N->E->S->W->N order for non-repeat R actions", () => {
    const kind = nextKind("miner-rotate-sequence-input");
    registerEntity(kind, {
      create: () => ({}),
      update: () => {
        // no-op
      },
    });

    const sim = createSim();
    const minerId = sim.addEntity({
      kind,
      pos: { x: 1, y: 1 },
      rot: "N",
    });
    const entity = sim.getEntityById(minerId) as { rot: Direction };
    const observed: Direction[] = [entity.rot];

    const stage = createMockInputStage();
    const controller = attachInput({
      app: {},
      stage,
      metrics: { tileSize: 16, gridSize: { cols: 8, rows: 8 } },
    });

    const detachRotate = controller.onRotate(() => {
      entity.rot = rotateDirection(entity.rot);
      observed.push(entity.rot);
    });

    stage.emit("keydown", { code: "KeyR", repeat: false });
    stage.emit("keydown", { code: "KeyR", repeat: false });
    stage.emit("keydown", { code: "KeyR", repeat: false });
    stage.emit("keydown", { code: "KeyR", repeat: false });

    expect(observed).toEqual(["N", "E", "S", "W", "N"]);

    detachRotate();
    controller.destroy();
  });

  test("blocks right-click removal on bare resource nodes without mutation side effects", () => {
    const resourceTile = { x: 3, y: 4 };
    let removeCalls = 0;

    const sim: Simulation = {
      canPlace: () => true,
      addEntity: () => undefined,
      removeEntity: () => {
        removeCalls += 1;
        return { ok: true, reasonCode: "removed" };
      },
      canRemove: (tile) => !(tile.x === resourceTile.x && tile.y === resourceTile.y),
      hasEntityAt: () => false,
      isResourceTile: (tile) => tile.x === resourceTile.x && tile.y === resourceTile.y,
    };

    const controller = createPlacementController(sim, { cols: 20, rows: 20 });
    controller.setCursor(resourceTile);
    const outcome = controller.clickRMB();

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("cannot_remove_resource");
    expect(outcome.token).toBe("blocked-resource");
    expect(removeCalls).toBe(0);
  });

  test("applies deterministic rotation with legacy two-arg addEntity entrypoint", () => {
    const kind = nextKind("miner-rotate-compat-input");
    registerEntity(kind, {
      create: () => ({}),
      update: () => {
        // no-op
      },
    });

    const sim = createSim();
    const minerId = sim.addEntity(kind, { pos: { x: 1, y: 1 } });
    const entity = sim.getEntityById(minerId) as { rot: Direction };

    const stage = createMockInputStage();
    const controller = attachInput({
      app: {},
      stage,
      metrics: { tileSize: 16, gridSize: { cols: 8, rows: 8 } },
    });

    const detachRotate = controller.onRotate(() => {
      entity.rot = rotateDirection(entity.rot);
    });
    expect(entity.rot).toBe("N");

    stage.emit("keydown", { code: "KeyR", repeat: false });
    stage.emit("keydown", { key: "r", repeat: false });
    expect(entity.rot).toBe("S");

    stage.emit("keydown", { code: "KeyR", repeat: true });
    stage.emit("keydown", { key: "x", repeat: false });
    expect(entity.rot).toBe("S");

    detachRotate();
    stage.emit("keydown", { key: "R", repeat: false });
    expect(entity.rot).toBe("S");

    controller.destroy();
  });

  test("does not consume power for blocked miner outputs", () => {
    const sim = createSim({ width: 12, height: 12, seed: 123 });
    const simMap = (sim as { getMap?: () => unknown }).getMap?.();
    if (typeof simMap !== "object" || simMap === null || typeof (simMap as { isOre?: unknown }).isOre !== "function") {
      throw new Error("Expected generated map with ore access");
    }

    const isOre = (simMap as { isOre: (x: number, y: number) => boolean }).isOre;
    let minerPosition: { x: number; y: number } | null = null;

    for (let y = 0; y < 12 && minerPosition === null; y += 1) {
      for (let x = 0; x < 10 && minerPosition === null; x += 1) {
        if (isOre(x, y) && isOre(x + 1, y)) {
          minerPosition = { x, y };
        }
      }
    }

    if (minerPosition === null) {
      throw new Error("Unable to find two horizontally-adjacent ore tiles in test map");
    }

    const minerId = sim.addEntity({
      kind: "miner",
      pos: minerPosition,
      rot: "E",
    } as Parameters<typeof sim.addEntity>[0]);
    const beltId = sim.addEntity({
      kind: "belt",
      pos: { x: minerPosition.x + 1, y: minerPosition.y },
      rot: "E",
    } as Parameters<typeof sim.addEntity>[0]);

    const belt = sim.getEntityById(beltId);
    if (belt === undefined || belt.state === undefined) {
      throw new Error("Expected belt state after creation");
    }
    (belt.state as { item?: unknown }).item = "iron-ore";

    const power = (sim as { getPowerState?: () => { storage: number; demandThisTick: number; consumedThisTick: number } }).getPowerState?.();
    if (power === undefined) {
      throw new Error("Expected power state API");
    }

    const beforeStorage = power.storage;
    const beforeConsumed = power.consumedThisTick;
    const beforeDemand = power.demandThisTick;

    sim.step((1000 / 60) * 60);

    const after = (sim as { getPowerState?: () => { storage: number; demandThisTick: number; consumedThisTick: number } }).getPowerState?.();
    if (after === undefined) {
      throw new Error("Expected power state API after stepping");
    }

    expect(after.storage).toBe(beforeStorage);
    expect(after.demandThisTick).toBe(beforeDemand);
    expect(after.consumedThisTick).toBe(beforeConsumed);

    const miner = sim.getEntityById(minerId);
    if (miner?.state === undefined) {
      throw new Error("Expected miner state");
    }

    const minerState = miner.state as { output?: unknown; hasOutput?: unknown };
    expect(minerState.hasOutput).toBe(false);
    expect(belt.state).toBeDefined();
    expect((belt.state as { item?: unknown }).item).toBe("iron-ore");
  });

  test("miner extracts coal when mined from coal ore tile", () => {
    const sim = createSim({
      width: 12,
      height: 12,
      seed: 404,
      restore: {
        power: {
          storage: 0,
          capacity: 240,
        },
      },
    });

    const simMap = (sim as { getMap?: () => unknown }).getMap?.();
    if (
      typeof simMap !== "object" ||
      simMap === null ||
      typeof (simMap as { isOre?: unknown; isCoal?: unknown }).isOre !== "function" ||
      typeof (simMap as { isCoal?: unknown }).isCoal !== "function"
    ) {
      throw new Error("Expected generated map with ore and coal access");
    }

    const { isOre, isCoal } = simMap as { isOre: (x: number, y: number) => boolean; isCoal: (x: number, y: number) => boolean };
    let minerPosition: { x: number; y: number } | null = null;

    for (let y = 0; y < 12 && minerPosition === null; y += 1) {
      for (let x = 0; x < 11 && minerPosition === null; x += 1) {
        if (!isCoal(x, y) || isOre(x + 1, y)) {
          continue;
        }

        minerPosition = { x, y };
      }
    }

    if (minerPosition === null) {
      throw new Error("Unable to find suitable coal tile for test");
    }

    const panelPos = minerPosition.y > 0 ? { x: minerPosition.x, y: minerPosition.y - 1 } : { x: minerPosition.x, y: minerPosition.y + 1 };
    sim.addEntity({
      kind: "solar-panel",
      pos: panelPos,
      rot: "S",
    } as Parameters<typeof sim.addEntity>[0]);

    const minerId = sim.addEntity({
      kind: "miner",
      pos: minerPosition,
      rot: "E",
    } as Parameters<typeof sim.addEntity>[0]);
    const beltId = sim.addEntity({
      kind: "belt",
      pos: { x: minerPosition.x + 1, y: minerPosition.y },
      rot: "E",
    } as Parameters<typeof sim.addEntity>[0]);

    sim.step((1000 / 60) * 60);

    const belt = sim.getEntityById(beltId);
    const miner = sim.getEntityById(minerId);
    if (belt?.state === undefined) {
      throw new Error("Expected belt state after stepping");
    }
    if (miner?.state === undefined) {
      throw new Error("Expected miner state after stepping");
    }

    expect((belt.state as { item?: unknown }).item).toBe("coal");
    expect((miner.state as { hasOutput?: unknown }).hasOutput).toBe(false);
  });

  test("does not consume power for blocked inserter drops", () => {
    const sim = createSim({ width: 12, height: 12, seed: 321 });
    const inserterId = sim.addEntity({
      kind: "inserter",
      pos: { x: 4, y: 3 },
      rot: "E",
    } as Parameters<typeof sim.addEntity>[0]);
    const beltId = sim.addEntity({
      kind: "belt",
      pos: { x: 5, y: 3 },
      rot: "E",
    } as Parameters<typeof sim.addEntity>[0]);

    const inserter = sim.getEntityById(inserterId);
    const belt = sim.getEntityById(beltId);
    if (inserter === undefined || belt === undefined) {
      throw new Error("Expected entities to exist");
    }

    const insertState = inserter.state as { holding?: unknown; tickPhase?: unknown };
    if (insertState === undefined) {
      throw new Error("Expected inserter state");
    }
    insertState.holding = "iron-ore";
    insertState.tickPhase = 19;
    (belt.state as { item?: unknown }).item = "iron-plate";

    const powerBefore = (sim as { getPowerState?: () => { demandThisTick: number; consumedThisTick: number } }).getPowerState?.();
    if (powerBefore === undefined) {
      throw new Error("Expected power state API");
    }

    const beforeDemand = powerBefore.demandThisTick;
    const beforeConsumed = powerBefore.consumedThisTick;

    sim.step((1000 / 60) * 20);

    const powerAfter = (sim as { getPowerState?: () => { demandThisTick: number; consumedThisTick: number } }).getPowerState?.();
    if (powerAfter === undefined) {
      throw new Error("Expected power state API after stepping");
    }

    expect(powerAfter.demandThisTick).toBe(beforeDemand);
    expect(powerAfter.consumedThisTick).toBe(beforeConsumed);
    expect(insertState.holding).toBe("iron-ore");
    expect((belt.state as { item?: unknown }).item).toBe("iron-plate");
  });

  test("generates power each tick from solar-panel entities", () => {
    const sim = createSim({ width: 8, height: 8, seed: 777 });
    sim.addEntity({
      kind: "solar-panel",
      pos: { x: 3, y: 3 },
      rot: "N",
    } as Parameters<typeof sim.addEntity>[0]);

    const before = (sim as { getPowerState?: () => { storage: number; generatedThisTick: number; demandThisTick: number; consumedThisTick: number } }).getPowerState?.();
    if (before === undefined) {
      throw new Error("Expected power state API");
    }

    const beforeStorage = before.storage;
    sim.step((1000 / 60) * 10);

    const after = (sim as { getPowerState?: () => { storage: number; generatedThisTick: number } }).getPowerState?.();
    if (after === undefined) {
      throw new Error("Expected power state API after stepping");
    }

    expect(after.generatedThisTick).toBeGreaterThan(0);
    expect(after.storage).toBeGreaterThan(beforeStorage);
  });

  test("tracks power demand and shortage by kind", () => {
    const sim = createSim({
      width: 12,
      height: 12,
      seed: 999,
      restore: {
        power: {
          storage: 0,
          capacity: 120,
        },
      },
    });
    const simMap = (sim as { getMap?: () => unknown }).getMap?.();
    if (typeof simMap !== "object" || simMap === null || typeof (simMap as { isOre?: unknown }).isOre !== "function") {
      throw new Error("Expected generated map with ore access");
    }

    const isOre = (simMap as { isOre: (x: number, y: number) => boolean }).isOre;
    let minerPosition: { x: number; y: number } | null = null;

    for (let y = 0; y < 12 && minerPosition === null; y += 1) {
      for (let x = 0; x < 11 && minerPosition === null; x += 1) {
        if (!isOre(x, y) || !isOre(x + 1, y)) {
          continue;
        }

        minerPosition = { x, y };
      }
    }

    if (minerPosition === null) {
      throw new Error("Unable to find mining tile with outbound target");
    }

    sim.addEntity({
      kind: "miner",
      pos: minerPosition,
      rot: "E",
    } as Parameters<typeof sim.addEntity>[0]);
    sim.addEntity({
      kind: "belt",
      pos: { x: minerPosition.x + 1, y: minerPosition.y },
      rot: "E",
    } as Parameters<typeof sim.addEntity>[0]);

    const powerBefore = (
      sim as {
        getPowerState?: () => {
          storage: number;
          demandThisTick: number;
          consumedThisTick: number;
          shortagesThisTick: number;
          demandByKind?: Record<string, number>;
          consumedByKind?: Record<string, number>;
        };
      }
    ).getPowerState?.();
    if (powerBefore === undefined) {
      throw new Error("Expected power state API");
    }

    sim.step((1000 / 60) * 60);

    const powerAfter = (
      sim as {
        getPowerState?: () => {
          storage: number;
          demandThisTick: number;
          consumedThisTick: number;
          shortagesThisTick: number;
          demandByKind: Record<string, number>;
          consumedByKind: Record<string, number>;
          generatedByKind: Record<string, number>;
        };
      }
    ).getPowerState?.();
    if (powerAfter === undefined) {
      throw new Error("Expected power state API after stepping");
    }

    expect(powerAfter.shortagesThisTick).toBeGreaterThan(0);
    expect(powerAfter.demandThisTick).toBeGreaterThan(powerBefore.demandThisTick);
    expect(powerAfter.consumedThisTick).toBe(powerBefore.consumedThisTick);
    expect(powerAfter.demandByKind?.miner).toBeGreaterThan(0);
    expect(powerAfter.consumedByKind?.miner ?? 0).toBe(0);
  });

  test("tracks generated power buckets by kind from solar panels", () => {
    const sim = createSim({ width: 8, height: 8, seed: 777 });
    sim.addEntity({
      kind: "solar-panel",
      pos: { x: 3, y: 3 },
      rot: "N",
    } as Parameters<typeof sim.addEntity>[0]);

    sim.step((1000 / 60) * 10);

    const after = (sim as { getPowerState?: () => { generatedByKind?: Record<string, number>; generatedThisTick: number } }).getPowerState?.();
    if (after === undefined) {
      throw new Error("Expected power state API after stepping");
    }

    expect(after.generatedThisTick).toBeGreaterThan(0);
    expect(after.generatedByKind?.["solar-panel"]).toBeGreaterThan(0);
    expect(after.generatedByKind?.["solar-panel"]).toBe(after.generatedThisTick);
  });

  test("consumer powers fail when disconnected from a power producer", () => {
    const sim = createSim({
      width: 12,
      height: 12,
      seed: 404,
      restore: {
        power: {
          storage: 0,
          capacity: 120,
        },
      },
    });

    const simMap = (sim as { getMap?: () => unknown }).getMap?.();
    if (typeof simMap !== "object" || simMap === null || typeof (simMap as { isOre?: unknown }).isOre !== "function") {
      throw new Error("Expected generated map with ore access");
    }

    const isOre = (simMap as { isOre: (x: number, y: number) => boolean }).isOre;
    let minerPosition: { x: number; y: number } | null = null;
    for (let y = 0; y < 12 && minerPosition === null; y += 1) {
      for (let x = 0; x < 11 && minerPosition === null; x += 1) {
        if (!isOre(x, y)) {
          continue;
        }

        const outputX = x + 1;
        if (outputX >= 12 || isOre(outputX, y)) {
          continue;
        }

        minerPosition = { x, y };
      }
    }

    if (minerPosition === null) {
      throw new Error("Unable to find suitable miner placement tile");
    }

    const miner = sim.addEntity({
      kind: "miner",
      pos: minerPosition,
      rot: "E",
    } as Parameters<typeof sim.addEntity>[0]);

    sim.addEntity({
      kind: "belt",
      pos: { x: minerPosition.x + 1, y: minerPosition.y },
      rot: "E",
    } as Parameters<typeof sim.addEntity>[0]);

    const before = (
      sim as {
        getPowerState?: () => {
          storage: number;
          networkConsumers: number;
          networkConnectedConsumers: number;
          networkDisconnectedConsumers: number;
          demandByKind: Record<string, number>;
          consumedByKind: Record<string, number>;
          shortagesThisTick: number;
        };
      }
    ).getPowerState?.();
    if (before === undefined) {
      throw new Error("Expected power state API");
    }

    sim.step((1000 / 60) * 60);

    const after = (
      sim as {
        getPowerState?: () => {
          storage: number;
          demandThisTick: number;
          consumedThisTick: number;
          networkProducers: number;
          networkConsumers: number;
          networkConnectedConsumers: number;
          networkDisconnectedConsumers: number;
          demandByKind: Record<string, number>;
          consumedByKind: Record<string, number>;
          shortagesThisTick: number;
        };
      }
    ).getPowerState?.();
    if (after === undefined) {
      throw new Error("Expected power state API after stepping");
    }

    expect(after.networkProducers).toBe(0);
    expect(after.networkConsumers).toBe(2);
    expect(after.networkConnectedConsumers).toBe(0);
    expect(after.networkDisconnectedConsumers).toBe(2);
    expect(after.demandThisTick).toBeGreaterThan(before.demandThisTick);
    expect(after.demandByKind.miner).toBeGreaterThan(0);
    expect(after.consumedByKind?.miner ?? 0).toBe(0);
    expect(after.consumedThisTick).toBe(0);
    expect(after.shortagesThisTick).toBeGreaterThan(0);

    const minerEntity = sim.getEntityById(miner);
    if (minerEntity?.state === undefined) {
      throw new Error("Expected miner entity");
    }

    expect((minerEntity.state as { hasOutput?: unknown }).hasOutput).toBe(false);
  });

  test("connected consumers consume power while disconnected consumers do not", () => {
    const sim = createSim({
      width: 12,
      height: 12,
      seed: 404,
      restore: {
        power: {
          storage: 0,
          capacity: 120,
        },
      },
    });

    const simMap = (sim as { getMap?: () => unknown }).getMap?.();
    if (typeof simMap !== "object" || simMap === null || typeof (simMap as { isOre?: unknown }).isOre !== "function") {
      throw new Error("Expected generated map with ore access");
    }

    const isOre = (simMap as { isOre: (x: number, y: number) => boolean }).isOre;
    const firstMiner = { x: null as number | null, y: null as number | null, outputX: null as number | null };
    const secondMiner = { x: null as number | null, y: null as number | null, outputX: null as number | null };
    const width = 12;
    const height = 12;

    for (let y = 0; y < height && firstMiner.x === null; y += 1) {
      for (let x = 0; x < width - 1 && firstMiner.x === null; x += 1) {
        const outputX = x + 1;
        if (isOre(x, y) && !isOre(outputX, y)) {
          firstMiner.x = x;
          firstMiner.y = y;
          firstMiner.outputX = outputX;
        }
      }
    }

    if (firstMiner.x === null || firstMiner.y === null || firstMiner.outputX === null) {
      throw new Error("Unable to find first miner placement tile");
    }

    const secondStartX = width - 3;
    for (let y = 0; y < height && secondMiner.x === null; y += 1) {
      for (let x = 1; x < secondStartX; x += 1) {
        const outputX = x + 1;
        if (x === firstMiner.x || outputX === firstMiner.outputX) {
          continue;
        }

        if (isOre(x, y) && !isOre(outputX, y)) {
          secondMiner.x = x;
          secondMiner.y = y;
          secondMiner.outputX = outputX;
        }
      }
    }

    if (secondMiner.x === null || secondMiner.y === null || secondMiner.outputX === null) {
      throw new Error("Unable to find second miner placement tile");
    }

    const panelTile = firstMiner.y > 0 ? { x: firstMiner.x, y: firstMiner.y - 1 } : { x: firstMiner.x, y: firstMiner.y + 1 };
    if (panelTile.y < 0 || panelTile.y >= height) {
      throw new Error("Unable to place panel on map while keeping miner connected");
    }

    sim.addEntity({
      kind: "solar-panel",
      pos: panelTile,
      rot: "S",
    } as Parameters<typeof sim.addEntity>[0]);

    sim.addEntity({
      kind: "miner",
      pos: { x: firstMiner.x, y: firstMiner.y },
      rot: "E",
    } as Parameters<typeof sim.addEntity>[0]);

    sim.addEntity({
      kind: "miner",
      pos: { x: secondMiner.x, y: secondMiner.y },
      rot: "E",
    } as Parameters<typeof sim.addEntity>[0]);

    sim.step((1000 / 60) * 1);
    const before = (
      sim as {
        getPowerState?: () => {
          networkProducers: number;
          networkConsumers: number;
          networkConnectedConsumers: number;
          networkDisconnectedConsumers: number;
          shortagesThisTick: number;
        };
      }
    ).getPowerState?.();
    if (before === undefined) {
      throw new Error("Expected power state API");
    }
    expect(before.networkProducers).toBe(1);
    expect(before.networkConsumers).toBe(2);
    expect(before.networkConnectedConsumers).toBe(1);
    expect(before.networkDisconnectedConsumers).toBe(1);

    sim.step((1000 / 60) * 60);

    const after = (
      sim as {
        getPowerState?: () => {
          networkProducers: number;
          networkConsumers: number;
          networkConnectedConsumers: number;
          networkDisconnectedConsumers: number;
          demandByKind: Record<string, number>;
          consumedByKind: Record<string, number>;
          demandThisTick: number;
          consumedThisTick: number;
          shortagesThisTick: number;
        };
      }
    ).getPowerState?.();
    if (after === undefined) {
      throw new Error("Expected power state API after stepping");
    }

    expect(after.networkProducers).toBe(1);
    expect(after.networkConsumers).toBe(2);
    expect(after.networkConnectedConsumers).toBe(1);
    expect(after.networkDisconnectedConsumers).toBe(1);
    expect(after.consumedByKind?.miner).toBe(2);
    expect(after.consumedThisTick).toBe(2);
    expect(after.demandByKind.miner).toBe(4);
    expect(after.demandThisTick).toBe(4);
    expect(after.shortagesThisTick).toBe(2);
  });

  test("network connectivity updates as producers are added", () => {
    const sim = createSim({
      width: 10,
      height: 10,
      seed: 404,
      restore: {
        power: {
          storage: 0,
          capacity: 120,
        },
      },
    });

    const map = (sim as { getMap?: () => unknown }).getMap?.();
    if (typeof map !== "object" || map === null || typeof (map as { isOre?: unknown }).isOre !== "function") {
      throw new Error("Expected generated map with ore access");
    }

    const isOre = (map as { isOre: (x: number, y: number) => boolean }).isOre;
    let minerPos: { x: number; y: number } | null = null;
    for (let y = 0; y < 10 && minerPos === null; y += 1) {
    for (let x = 0; x < 8 && minerPos === null; x += 1) {
        if (isOre(x, y) && !isOre(x + 1, y)) {
          minerPos = { x, y };
        }
      }
    }

    if (minerPos === null) {
      throw new Error("Unable to find suitable miner placement tile");
    }

    sim.addEntity({
      kind: "miner",
      pos: minerPos,
      rot: "E",
    } as Parameters<typeof sim.addEntity>[0]);

    sim.step((1000 / 60) * 1);
    const before = (
      sim as {
        getPowerState?: () => {
          networkProducers: number;
          networkConsumers: number;
          networkDisconnectedConsumers: number;
        };
      }
    ).getPowerState?.();
    if (before === undefined) {
      throw new Error("Expected power state API");
    }

    expect(before.networkProducers).toBe(0);
    expect(before.networkConsumers).toBe(1);
    expect(before.networkDisconnectedConsumers).toBe(1);

    sim.addEntity({
      kind: "solar-panel",
      pos: { x: minerPos.x + 2, y: minerPos.y },
      rot: "W",
    } as Parameters<typeof sim.addEntity>[0]);

    sim.step((1000 / 60) * 1);

    const mid = (
      sim as {
        getPowerState?: () => {
          networkProducers: number;
          networkConsumers: number;
          networkConnectedConsumers: number;
          networkDisconnectedConsumers: number;
        };
      }
    ).getPowerState?.();
    if (mid === undefined) {
      throw new Error("Expected power state API");
    }

    expect(mid.networkProducers).toBe(1);
    expect(mid.networkConsumers).toBe(1);
    expect(mid.networkConnectedConsumers).toBe(0);
    expect(mid.networkDisconnectedConsumers).toBe(1);

    const chainPanel = { x: minerPos.x + 1, y: minerPos.y };
    const existingChainNodes = sim.getEntitiesAt(chainPanel);
    if (existingChainNodes[0] !== undefined) {
      sim.removeEntity(existingChainNodes[0].id);
    }
    sim.addEntity({
      kind: "splitter",
      pos: chainPanel,
      rot: "N",
    } as Parameters<typeof sim.addEntity>[0]);

    sim.step((1000 / 60) * 1);
    const after = (
      sim as {
        getPowerState?: () => {
          networkProducers: number;
          networkConsumers: number;
          networkConnectedConsumers: number;
          networkDisconnectedConsumers: number;
        };
      }
    ).getPowerState?.();
    if (after === undefined) {
      throw new Error("Expected power state API after adding consumer");
    }

    expect(after.networkProducers).toBe(1);
    expect(after.networkConsumers).toBe(2);
    expect(after.networkConnectedConsumers).toBe(1);
    expect(after.networkDisconnectedConsumers).toBe(1);
  });

  test("power network is recalculated each tick with new power node geometry", () => {
    const sim = createSim({
      width: 10,
      height: 10,
      seed: 404,
      restore: {
        power: {
          storage: 0,
          capacity: 120,
        },
      },
    });

    const simMap = (sim as { getMap?: () => unknown }).getMap?.();
    if (typeof simMap !== "object" || simMap === null || typeof (simMap as { isOre?: unknown }).isOre !== "function") {
      throw new Error("Expected generated map with ore access");
    }

    const isOre = (simMap as { isOre: (x: number, y: number) => boolean }).isOre;
    let minerX = -1;
    let minerY = -1;
    for (let y = 0; y < 10 && minerY < 0; y += 1) {
    for (let x = 0; x < 7 && minerY < 0; x += 1) {
        if (isOre(x, y) && !isOre(x + 1, y)) {
          minerX = x;
          minerY = y;
        }
      }
    }

    if (minerX < 0 || minerY < 0) {
      throw new Error("Unable to find suitable miner tile");
    }

    sim.addEntity({
      kind: "miner",
      pos: { x: minerX, y: minerY },
      rot: "E",
    } as Parameters<typeof sim.addEntity>[0]);

    sim.addEntity({
      kind: "solar-panel",
      pos: { x: minerX + 1, y: minerY },
      rot: "W",
    } as Parameters<typeof sim.addEntity>[0]);

    sim.step((1000 / 60) * 5);

    const mid = (
      sim as {
        getPowerState?: () => {
          networkProducers: number;
          networkConsumers: number;
          networkConnectedConsumers: number;
          networkDisconnectedConsumers: number;
        };
      }
    ).getPowerState?.();
    if (mid === undefined) {
      throw new Error("Expected power state API");
    }
    expect(mid.networkProducers).toBe(1);
    expect(mid.networkConsumers).toBe(1);
    expect(mid.networkConnectedConsumers).toBe(1);
    expect(mid.networkDisconnectedConsumers).toBe(0);

    const removablePanels = sim.getEntitiesAt({ x: minerX + 1, y: minerY });
    if (removablePanels[0] === undefined) {
      throw new Error("Expected removable panel at existing tile");
    }
    sim.removeEntity(removablePanels[0].id);
    sim.addEntity({
      kind: "solar-panel",
      pos: { x: minerX + 3, y: minerY },
      rot: "W",
    } as Parameters<typeof sim.addEntity>[0]);

    sim.step((1000 / 60) * 5);
    const after = (
      sim as {
        getPowerState?: () => {
          networkProducers: number;
          networkConsumers: number;
          networkConnectedConsumers: number;
          networkDisconnectedConsumers: number;
        };
      }
    ).getPowerState?.();
    if (after === undefined) {
      throw new Error("Expected power state API after movement");
    }

    expect(after.networkProducers).toBe(1);
    expect(after.networkConsumers).toBe(1);
    expect(after.networkConnectedConsumers).toBe(0);
    expect(after.networkDisconnectedConsumers).toBe(1);
  });

  test("preserves belt item filters across restore payloads", () => {
    const sim = createSim({
      width: 6,
      height: 3,
      seed: 999,
      restore: {
        tick: 5,
        tickCount: 5,
        elapsedMs: 0,
        entities: [
          {
            kind: "belt",
            pos: { x: 1, y: 1 },
            rot: "E",
            state: {
              item: "iron-plate",
              accept: "iron-plate",
              tickPhase: 5,
            },
          },
          {
            kind: "belt",
            pos: { x: 2, y: 1 },
            rot: "E",
            state: {
              items: [null, null, null, null],
            },
          },
        ],
      },
    });

    const source = sim.getEntitiesAt({ x: 1, y: 1 })[0];
    const target = sim.getEntitiesAt({ x: 2, y: 1 })[0];
    if (source?.state === undefined || target?.state === undefined) {
      throw new Error("Expected restored belt states to include state payload");
    }

    const sourceState = source.state as { accept?: unknown; item?: unknown };
    const targetState = target.state as { item?: unknown };
    expect(sourceState.accept).toBe("iron-plate");
    expect(sourceState.item).toBe("iron-plate");

    sim.step((1000 / 60) * 10);

    expect(sourceState.item).toBeNull();
    expect(targetState.item).toBe("iron-plate");
  });
});
