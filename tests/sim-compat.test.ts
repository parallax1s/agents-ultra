import { describe, expect, it } from "vitest";

import { registerEntity } from "../src/core/registry";
import { createSim } from "../src/core/sim";
import { rotateDirection, type Direction, type EntityBase, type ItemKind } from "../src/core/types";
import { attachInput } from "../src/ui/input";

const TICK_MS = 1000 / 60;

const COMPAT_KIND = "compat-probe-entity";
const COMPAT_MINER_KIND = "compat-legacy-miner";
const COMPAT_BELT_KIND = "compat-legacy-belt";
const COMPAT_INSERTER_KIND = "compat-legacy-inserter";
const COMPAT_FURNACE_KIND = "compat-legacy-furnace";
const COMPAT_CHAIN_MINER_KIND = "compat-cadence-regression-miner";
const COMPAT_CHAIN_BELT_KIND = "compat-cadence-regression-belt";
const COMPAT_CHAIN_INSERTER_KIND = "compat-cadence-regression-inserter";
const COMPAT_CHAIN_FURNACE_KIND = "compat-cadence-regression-furnace";

let definitionRegistered = false;
let oreToPlatePathRegistered = false;
let cadenceChainPathRegistered = false;
let compatKindCounter = 0;

type Vector = {
  x: number;
  y: number;
};

type CompatMinerState = {
  ticks: number;
  holding: ItemKind | null;
  attempts: number;
  moved: number;
  blocked: number;
};

type CompatBeltState = {
  ticks: number;
  item: ItemKind | null;
  attempts: number;
};

type CompatInserterState = {
  ticks: number;
  holding: ItemKind | null;
  attempts: number;
  pickups: number;
  drops: number;
  blockedPickups: number;
  blockedDrops: number;
};

type CompatFurnaceState = {
  input: ItemKind | null;
  output: ItemKind | null;
  crafting: boolean;
  progressTicks: number;
  completed: number;
};

type CompatCadenceBeltState = CompatBeltState & { moved: number };

const COMPAT_MINER_ATTEMPTS = 2;
const COMPAT_INSERTER_ATTEMPTS = 2;
const COMPAT_FURNACE_SMELT_TICKS = 3;
const COMPAT_CHAIN_MINER_ATTEMPTS = 60;
const COMPAT_CHAIN_BELT_ATTEMPTS = 15;
const COMPAT_CHAIN_INSERTER_ATTEMPTS = 20;
const COMPAT_CHAIN_FURNACE_SMELT_TICKS = 180;
const ORE_TO_PLATE_DIRECTION: Record<Direction, Vector> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

function ensureCompatDefinition(): void {
  if (definitionRegistered) {
    return;
  }

  registerEntity(COMPAT_KIND, {
    create: () => ({ ticks: 0 }),
    update: (entity) => {
      const state = (entity.state ?? {}) as { ticks?: number };
      const current = typeof state.ticks === "number" ? state.ticks : 0;
      state.ticks = current + 1;
      entity.state = state;
    },
  });

  definitionRegistered = true;
}

const asState = <T extends object>(value: unknown): T | undefined => {
  if (value === null || typeof value !== "object") {
    return undefined;
  }

  return value as T;
};

const offsetFrom = (direction: Direction): Vector => ORE_TO_PLATE_DIRECTION[direction];

const nextKind = (prefix: string): string => {
  compatKindCounter += 1;
  return `${prefix}-${compatKindCounter}`;
};

const findKindAt = (sim: unknown, pos: Vector, kind: string): EntityBase | undefined => {
  if (typeof sim !== "object" || sim === null || !("getEntitiesAt" in sim)) {
    return undefined;
  }

  const candidate = sim as { getEntitiesAt(pos: Vector): EntityBase[] };
  if (typeof candidate.getEntitiesAt !== "function") {
    return undefined;
  }

  return candidate.getEntitiesAt(pos).find((entity) => entity.kind === kind);
};

const ensureOreToPlateDefinitions = (): void => {
  if (oreToPlatePathRegistered) {
    return;
  }

  registerEntity(COMPAT_MINER_KIND, {
    create: () => ({
      ticks: 0,
      holding: null as ItemKind | null,
      attempts: 0,
      moved: 0,
      blocked: 0,
    }),
    update: (entity, _dtMs, sim) => {
      const state = asState<CompatMinerState>(entity.state);
      if (state === undefined) {
        return;
      }

      state.ticks += 1;
      if (state.ticks % COMPAT_MINER_ATTEMPTS !== 0) {
        return;
      }

      if (state.holding === null) {
        state.holding = "iron-ore";
      }

      const ahead = {
        x: entity.pos.x + offsetFrom(entity.rot).x,
        y: entity.pos.y + offsetFrom(entity.rot).y,
      };
      const belt = findKindAt(sim, ahead, COMPAT_BELT_KIND);
      const beltState = asState<CompatBeltState>(belt?.state);

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

  registerEntity(COMPAT_BELT_KIND, {
    create: () => ({ ticks: 0, item: null as ItemKind | null, attempts: 0 }),
    update: (entity) => {
      const state = asState<CompatBeltState>(entity.state);
      if (state === undefined) {
        return;
      }

      state.ticks += 1;
      if (state.ticks % 2 === 0) {
        state.attempts += 1;
      }
    },
  });

  registerEntity(COMPAT_INSERTER_KIND, {
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
      const state = asState<CompatInserterState>(entity.state);
      if (state === undefined) {
        return;
      }

      state.ticks += 1;
      if (state.ticks % COMPAT_INSERTER_ATTEMPTS !== 0) {
        return;
      }

      state.attempts += 1;

      if (state.holding === null) {
        const source = {
          x: entity.pos.x + offsetFrom(entity.rot).x * -1,
          y: entity.pos.y + offsetFrom(entity.rot).y * -1,
        };
        const belt = findKindAt(sim, source, COMPAT_BELT_KIND);
        const sourceState = asState<CompatBeltState>(belt?.state);

        if (sourceState === undefined || sourceState.item === null) {
          state.blockedPickups += 1;
          return;
        }

        state.holding = sourceState.item;
        sourceState.item = null;
        state.pickups += 1;
        return;
      }

      const target = {
        x: entity.pos.x + offsetFrom(entity.rot).x,
        y: entity.pos.y + offsetFrom(entity.rot).y,
      };
      const furnace = findKindAt(sim, target, COMPAT_FURNACE_KIND);
      const furnaceState = asState<CompatFurnaceState>(furnace?.state);

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

  registerEntity(COMPAT_FURNACE_KIND, {
    create: () => ({
      input: null as ItemKind | null,
      output: null as ItemKind | null,
      crafting: false,
      progressTicks: 0,
      completed: 0,
    }),
    update: (entity) => {
      const state = asState<CompatFurnaceState>(entity.state);
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

      if (state.progressTicks < COMPAT_FURNACE_SMELT_TICKS) {
        state.progressTicks += 1;
      }

      if (state.progressTicks < COMPAT_FURNACE_SMELT_TICKS) {
        return;
      }

      state.output = "iron-plate";
      state.crafting = false;
      state.progressTicks = 0;
      state.completed += 1;
    },
  });

  oreToPlatePathRegistered = true;
};

const ensureCadenceChainDefinitions = (): void => {
  if (cadenceChainPathRegistered) {
    return;
  }

  registerEntity(COMPAT_CHAIN_MINER_KIND, {
    create: () => ({
      ticks: 0,
      holding: "iron-ore" as ItemKind | null,
      attempts: 0,
      moved: 0,
      blocked: 0,
    }),
    update: (entity, _dtMs, sim) => {
      const state = asState<CompatMinerState>(entity.state);
      if (state === undefined) {
        return;
      }

      state.ticks += 1;
      if (state.ticks % COMPAT_CHAIN_MINER_ATTEMPTS !== 0) {
        return;
      }

      if (state.holding === null) {
        state.holding = "iron-ore";
      }

      const ahead = {
        x: entity.pos.x + offsetFrom(entity.rot).x,
        y: entity.pos.y + offsetFrom(entity.rot).y,
      };
      const belt = findKindAt(sim, ahead, COMPAT_CHAIN_BELT_KIND);
      const beltState = asState<CompatBeltState>(belt?.state);

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

  registerEntity(COMPAT_CHAIN_BELT_KIND, {
    create: () => ({ ticks: 0, item: null as ItemKind | null, attempts: 0, moved: 0, blocked: 0 }),
    update: (entity, _dtMs, sim) => {
      const state = asState<CompatCadenceBeltState>(entity.state);
      if (state === undefined) {
        return;
      }

      state.ticks += 1;
      if (state.ticks % COMPAT_CHAIN_BELT_ATTEMPTS !== 0 || state.item === null) {
        return;
      }

      const ahead = {
        x: entity.pos.x + offsetFrom(entity.rot).x,
        y: entity.pos.y + offsetFrom(entity.rot).y,
      };
      const inserter = findKindAt(sim, ahead, COMPAT_CHAIN_INSERTER_KIND);
      const inserterState = asState<CompatInserterState>(inserter?.state);

      if (inserterState === undefined || inserterState.holding !== null) {
        return;
      }

      inserterState.holding = state.item;
      state.item = null;
      state.moved += 1;
    },
  });

  registerEntity(COMPAT_CHAIN_INSERTER_KIND, {
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
      const state = asState<CompatInserterState>(entity.state);
      if (state === undefined) {
        return;
      }

      state.ticks += 1;
      if (state.ticks % COMPAT_CHAIN_INSERTER_ATTEMPTS !== 0) {
        return;
      }

      state.attempts += 1;

      if (state.holding === null) {
        const source = {
          x: entity.pos.x + offsetFrom(entity.rot).x * -1,
          y: entity.pos.y + offsetFrom(entity.rot).y * -1,
        };
        const belt = findKindAt(sim, source, COMPAT_CHAIN_BELT_KIND);
        const beltState = asState<CompatBeltState>(belt?.state);

        if (beltState === undefined || beltState.item === null) {
          state.blockedPickups += 1;
          return;
        }

        state.holding = beltState.item;
        beltState.item = null;
        state.pickups += 1;
        return;
      }

      const target = {
        x: entity.pos.x + offsetFrom(entity.rot).x,
        y: entity.pos.y + offsetFrom(entity.rot).y,
      };
      const furnace = findKindAt(sim, target, COMPAT_CHAIN_FURNACE_KIND);
      const furnaceState = asState<CompatFurnaceState>(furnace?.state);

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

  registerEntity(COMPAT_CHAIN_FURNACE_KIND, {
    create: () => ({
      input: null as ItemKind | null,
      output: null as ItemKind | null,
      crafting: false,
      progressTicks: 0,
      completed: 0,
    }),
    update: (entity) => {
      const state = asState<CompatFurnaceState>(entity.state);
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

      if (state.progressTicks < COMPAT_CHAIN_FURNACE_SMELT_TICKS) {
        state.progressTicks += 1;
      }

      if (state.progressTicks < COMPAT_CHAIN_FURNACE_SMELT_TICKS) {
        return;
      }

      state.output = "iron-plate";
      state.crafting = false;
      state.progressTicks = 0;
      state.completed += 1;
    },
  });

  cadenceChainPathRegistered = true;
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

describe("sim API compatibility", () => {
  it("supports legacy object-style addEntity({ kind, pos, rot })", () => {
    ensureCompatDefinition();
    const sim = createSim();

    const id = sim.addEntity({
      kind: COMPAT_KIND,
      pos: { x: 2, y: 3 },
      rot: "E",
    });

    expect(id).toBeTypeOf("string");
    expect(sim.getEntityById(id)).toMatchObject({
      id,
      kind: COMPAT_KIND,
      pos: { x: 2, y: 3 },
      rot: "E",
    });
  });

  it("supports two-arg addEntity(kind, init) and defaults rotation to N", () => {
    ensureCompatDefinition();
    const sim = createSim({ width: 8, height: 8, seed: 1 });

    const id = sim.addEntity(COMPAT_KIND, {
      pos: { x: 1, y: 1 },
    });

    const entity = sim.getEntityById(id);
    expect(entity?.rot).toBe("N");
    sim.step(1000 / 60);
    expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(1);
  });

  it("applies fixed-step updates deterministically for legacy addEntity(kind, init)", () => {
    ensureCompatDefinition();

    const runScenario = (): { updates: number; tickCount: number; elapsedMs: number } => {
      const sim = createSim({ width: 12, height: 12, seed: 17 });
      const id = sim.addEntity(COMPAT_KIND, { pos: { x: 0, y: 0 } });

      sim.step(TICK_MS / 2);
      expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(0);
      expect(sim.tickCount).toBe(0);

      sim.step(TICK_MS / 2);
      expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(1);
      expect(sim.tickCount).toBe(1);

      sim.step(TICK_MS * 2 + TICK_MS / 2);
      expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(3);
      expect(sim.tickCount).toBe(3);

      return {
        updates: (sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks ?? 0,
        tickCount: sim.tickCount,
        elapsedMs: sim.elapsedMs,
      };
    };

    const first = runScenario();
    const second = runScenario();

    expect(first).toEqual(second);
    expect(first.updates).toBe(3);
    expect(first.tickCount).toBe(3);
    expect(first.elapsedMs).toBeCloseTo(3 * TICK_MS);
    expect(first.elapsedMs).toBe(second.elapsedMs);
  });

  it("holds fixed-step accumulator behavior through pause/resume for legacy call patterns", () => {
    ensureCompatDefinition();
    const sim = createSim({ width: 10, height: 10, seed: 4 });

    const id = sim.addEntity(COMPAT_KIND, { pos: { x: 2, y: 2 } });

    sim.step(TICK_MS * 3);
    expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(3);
    expect(sim.tickCount).toBe(3);
    expect(sim.elapsedMs).toBeCloseTo(3 * TICK_MS);
    const pausedTickCount = sim.tickCount;
    const pausedElapsedMs = sim.elapsedMs;
    const pausedStateTicks = (sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks;

    sim.pause();
    sim.step(TICK_MS * 10);
    sim.step(TICK_MS * 10);
    expect(sim.tickCount).toBe(pausedTickCount);
    expect(sim.elapsedMs).toBe(pausedElapsedMs);
    expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(pausedStateTicks);

    sim.resume();
    sim.step(TICK_MS / 4);
    expect(sim.tickCount).toBe(pausedTickCount);
    expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(pausedStateTicks);

    sim.step((TICK_MS * 3) / 4);
    expect(sim.tickCount).toBe(pausedTickCount + 1);
    expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(pausedTickCount + 1);
  });

  it("preserves move cadence through pause for legacy addEntity(kind, init) inputs", () => {
    const kind = nextKind("compat-legacy-move-pause");

    registerEntity(kind, {
      create: () => ({ ticks: 0 }),
      update: (entity) => {
        if (typeof entity !== "object" || entity === null || !("state" in entity)) {
          throw new Error("Unexpected entity shape passed to update");
        }

        const state = asState<{ ticks?: number }>(entity.state);
        if (state === undefined) {
          throw new Error("Expected entity state to be object");
        }

        state.ticks = (state.ticks ?? 0) + 1;
        entity.pos = {
          x: entity.pos.x + 1,
          y: entity.pos.y,
        };
      },
    });

    const runWithPause = (): { tickCount: number; elapsedMs: number; posX: number; ticks: number } => {
      const sim = createSim({ width: 12, height: 12, seed: 3 });
      const id = sim.addEntity(kind, {
        pos: { x: 2, y: 2 },
      });

      sim.step(TICK_MS / 2);
      sim.pause();
      sim.step(TICK_MS * 4);
      sim.resume();
      sim.step(TICK_MS / 2);

      const entity = sim.getEntityById(id);
      const state = asState<{ ticks?: number }>(entity?.state);
      return {
        tickCount: sim.tickCount,
        elapsedMs: sim.elapsedMs,
        posX: entity?.pos.x ?? 0,
        ticks: state?.ticks ?? 0,
      };
    };

    const runWithoutPause = (): { tickCount: number; elapsedMs: number; posX: number; ticks: number } => {
      const sim = createSim({ width: 12, height: 12, seed: 3 });
      const id = sim.addEntity(kind, {
        pos: { x: 2, y: 2 },
      });

      sim.step(TICK_MS / 2);
      sim.step(TICK_MS / 2);

      const entity = sim.getEntityById(id);
      const state = asState<{ ticks?: number }>(entity?.state);
      return {
        tickCount: sim.tickCount,
        elapsedMs: sim.elapsedMs,
        posX: entity?.pos.x ?? 0,
        ticks: state?.ticks ?? 0,
      };
    };

    expect(runWithoutPause()).toEqual(runWithPause());
  });

  it("rejects out-of-bounds placements with a clear error", () => {
    ensureCompatDefinition();
    const sim = createSim({ width: 4, height: 4, seed: 1 });

    expect(() =>
      sim.addEntity(COMPAT_KIND, {
        pos: { x: 4, y: 0 },
      }),
    ).toThrow(/out of bounds/i);
  });

  it("keeps rotate-input behavior stable when using legacy addEntity style", () => {
    ensureCompatDefinition();
    const sim = createSim({ width: 8, height: 8, seed: 2 });

    const id = sim.addEntity(COMPAT_KIND, { pos: { x: 1, y: 1 } });
    const entity = sim.getEntityById(id);

    expect(entity?.rot).toBe("N");

    const stage = createMockInputStage();
    const controller = attachInput({
      app: {},
      stage,
      metrics: { tileSize: 16, gridSize: { cols: 8, rows: 8 } },
    });
    const stopRotate = controller.onRotate(() => {
      if (entity !== undefined) {
        entity.rot = rotateDirection(entity.rot);
      }
    });

    stage.emit("keydown", { code: "KeyR", repeat: false });
    stage.emit("keydown", { key: "r", repeat: false });
    stage.emit("keydown", { code: "KeyR", repeat: true });

    expect(entity?.rot).toBe("S");

    stopRotate();
    stage.emit("keydown", { code: "KeyR", repeat: false });
    expect(entity?.rot).toBe("S");

    controller.destroy();
  });

  it("supports deterministic fixed-step ore-to-plate progression through legacy paths", () => {
    ensureOreToPlateDefinitions();

    const runScenario = (): {
      tickCount: number;
      elapsedMs: number;
      miner: CompatMinerState;
      belt: CompatBeltState;
      inserter: CompatInserterState;
      furnace: CompatFurnaceState;
    } => {
      const sim = createSim({ width: 9, height: 3, seed: 8 });

      const minerId = sim.addEntity({ kind: COMPAT_MINER_KIND, pos: { x: 1, y: 1 }, rot: "E" });
      sim.addEntity({ kind: COMPAT_BELT_KIND, pos: { x: 2, y: 1 }, rot: "E" });
      const inserterId = sim.addEntity({ kind: COMPAT_INSERTER_KIND, pos: { x: 3, y: 1 }, rot: "E" });
      const furnaceId = sim.addEntity({ kind: COMPAT_FURNACE_KIND, pos: { x: 4, y: 1 }, rot: "E" });

      for (let i = 0; i < 7; i += 1) {
        sim.step(TICK_MS);
      }

      const miner = sim.getEntityById(minerId);
      const inserter = sim.getEntityById(inserterId);
      const furnace = sim.getEntityById(furnaceId);
      const beltEntity = sim.getEntitiesAt({ x: 2, y: 1 })[0];

      if (
        miner?.state === undefined ||
        inserter?.state === undefined ||
        furnace?.state === undefined ||
        beltEntity?.state === undefined
      ) {
        throw new Error("Expected all ore-to-plate entities to have states");
      }

      const minerState = asState<CompatMinerState>(miner.state);
      const inserterState = asState<CompatInserterState>(inserter.state);
      const beltState = asState<CompatBeltState>(beltEntity.state);
      const furnaceState = asState<CompatFurnaceState>(furnace.state);

      if (
        minerState === undefined ||
        inserterState === undefined ||
        beltState === undefined ||
        furnaceState === undefined
      ) {
        throw new Error("Expected typed entity states for ore-to-plate scenario");
      }

      return {
        tickCount: sim.tickCount,
        elapsedMs: sim.elapsedMs,
        miner: { ...minerState },
        belt: { ...beltState },
        inserter: { ...inserterState },
        furnace: { ...furnaceState },
      };
    };

    const first = runScenario();
    const second = runScenario();

    expect(first).toEqual(second);
    expect(first.tickCount).toBe(7);
    expect(first.elapsedMs).toBeCloseTo(7 * TICK_MS);
    expect(first.furnace.output).toBe("iron-plate");
    expect(first.furnace.completed).toBe(1);
    expect(first.inserter.holding).toBe("iron-ore");
    expect(first.belt.item).toBeNull();
  });

  it("enforces exact miner->belt->inserter->furnace progression at 60/20/15/180 boundaries", () => {
    ensureCadenceChainDefinitions();

    const sim = createSim({ width: 10, height: 3, seed: 12 });
    const minerId = sim.addEntity({ kind: COMPAT_CHAIN_MINER_KIND, pos: { x: 1, y: 1 }, rot: "E" });
    const beltId = sim.addEntity({ kind: COMPAT_CHAIN_BELT_KIND, pos: { x: 2, y: 1 }, rot: "E" });
    const inserterId = sim.addEntity({
      kind: COMPAT_CHAIN_INSERTER_KIND,
      pos: { x: 3, y: 1 },
      rot: "E",
    });
    const furnaceId = sim.addEntity({ kind: COMPAT_CHAIN_FURNACE_KIND, pos: { x: 4, y: 1 }, rot: "E" });

    const miner = sim.getEntityById(minerId);
    const beltEntity = sim.getEntityById(beltId);
    const inserter = sim.getEntityById(inserterId);
    const furnace = sim.getEntityById(furnaceId);

    if (miner?.state === undefined || beltEntity?.state === undefined || inserter?.state === undefined || furnace?.state === undefined) {
      throw new Error("Expected all cadence entities to have states");
    }

    const minerState = asState<CompatMinerState>(miner.state);
    const beltState = asState<CompatCadenceBeltState>(beltEntity.state);
    const inserterState = asState<CompatInserterState>(inserter.state);
    const furnaceState = asState<CompatFurnaceState>(furnace.state);

    if (minerState === undefined || beltState === undefined || inserterState === undefined || furnaceState === undefined) {
      throw new Error("Expected typed entity states for cadence-chain entities");
    }

    let tick = 0;
    const advanceTo = (targetTick: number): void => {
      if (targetTick < tick) {
        throw new Error(`advanceTo target ${targetTick} is before current tick ${tick}`);
      }
      for (let i = 0; i < targetTick - tick; i += 1) {
        sim.step(TICK_MS);
      }
      tick = targetTick;
    };

    advanceTo(14);
    expect(tick).toBe(14);
    expect(minerState).toMatchObject({ ticks: 14, holding: "iron-ore", moved: 0, attempts: 0 });
    expect(beltState).toMatchObject({ ticks: 14, item: null, moved: 0 });
    expect(inserterState).toMatchObject({
      ticks: 14,
      holding: null,
      pickups: 0,
      drops: 0,
      attempts: 0,
    });
    expect(furnaceState).toMatchObject({ input: null, output: null, crafting: false, progressTicks: 0, completed: 0 });

    advanceTo(15);
    expect(tick).toBe(15);
    expect(beltState).toMatchObject({ item: null, moved: 0 });
    expect(furnaceState.crafting).toBe(false);

    advanceTo(20);
    expect(tick).toBe(20);
    expect(inserterState).toMatchObject({ attempts: 1 });
    expect(inserterState.holding).toBeNull();

    advanceTo(59);
    expect(tick).toBe(59);
    expect(minerState).toMatchObject({ attempts: 0, moved: 0 });
    expect(beltState.item).toBeNull();
    expect(inserterState.holding).toBeNull();
    expect(furnaceState.crafting).toBe(false);

    advanceTo(60);
    expect(tick).toBe(60);
    expect(minerState).toMatchObject({ attempts: 1, moved: 1 });
    expect(beltState).toMatchObject({ item: null });
    expect(inserterState).toMatchObject({ attempts: 3, pickups: 0, drops: 1, holding: null });
    expect(furnaceState).toMatchObject({
      crafting: true,
      completed: 0,
      input: null,
      output: null,
      progressTicks: 0,
    });

    advanceTo(61);
    expect(tick).toBe(61);
    expect(furnaceState).toMatchObject({ crafting: true, progressTicks: 1, output: null });

    advanceTo(239);
    expect(tick).toBe(239);
    expect(furnaceState).toMatchObject({ crafting: true, progressTicks: 179, output: null, completed: 0 });

    advanceTo(240);
    expect(tick).toBe(240);
    expect(furnaceState).toMatchObject({ output: "iron-plate", progressTicks: 0, completed: 1 });

    advanceTo(241);
    expect(tick).toBe(241);
    expect(furnaceState).toMatchObject({ output: "iron-plate", crafting: false, completed: 1 });
  });

  it("halts chain movement during pause and preserves prior cadence offsets after resume", () => {
    ensureCadenceChainDefinitions();

    const runScenario = (withPause: boolean): string => {
      const sim = createSim({ width: 10, height: 3, seed: 13 });

      const minerId = sim.addEntity({ kind: COMPAT_CHAIN_MINER_KIND, pos: { x: 1, y: 1 }, rot: "E" });
      const beltId = sim.addEntity({ kind: COMPAT_CHAIN_BELT_KIND, pos: { x: 2, y: 1 }, rot: "E" });
      const inserterId = sim.addEntity({ kind: COMPAT_CHAIN_INSERTER_KIND, pos: { x: 3, y: 1 }, rot: "E" });
      const furnaceId = sim.addEntity({ kind: COMPAT_CHAIN_FURNACE_KIND, pos: { x: 4, y: 1 }, rot: "E" });

      const miner = sim.getEntityById(minerId);
      const belt = sim.getEntityById(beltId);
      const inserter = sim.getEntityById(inserterId);
      const furnace = sim.getEntityById(furnaceId);

      if (miner?.state === undefined || belt?.state === undefined || inserter?.state === undefined || furnace?.state === undefined) {
        throw new Error("Expected all cadence entities to have states");
      }

      const tickStates: Array<{
        tick: number;
        miner: CompatMinerState;
        belt: CompatCadenceBeltState;
        inserter: CompatInserterState;
        furnace: CompatFurnaceState;
      }> = [];

      const currentSnapshot = (tick: number): {
        tick: number;
        miner: CompatMinerState;
        belt: CompatCadenceBeltState;
        inserter: CompatInserterState;
        furnace: CompatFurnaceState;
      } => {
        const minerState = asState<CompatMinerState>(miner.state);
        const beltState = asState<CompatCadenceBeltState>(belt.state);
        const inserterState = asState<CompatInserterState>(inserter.state);
        const furnaceState = asState<CompatFurnaceState>(furnace.state);

        if (minerState === undefined || beltState === undefined || inserterState === undefined || furnaceState === undefined) {
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

      const stepTicks = (ticks: number): void => {
        for (let i = 0; i < ticks; i += 1) {
          sim.step(TICK_MS);
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

    const withoutPause = runScenario(false);
    const withPause = runScenario(true);

    expect(withPause).toBe(withoutPause);
  });
});
