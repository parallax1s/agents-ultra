import { describe, expect, it } from "vitest";

import { createMap } from "../src/core/map";
import { createSim } from "../src/core/sim";
import { registerEntity, getDefinition } from "../src/core/registry";
import { createSnapshot } from "../src/core/snapshot";
import type { Direction, ItemKind } from "../src/core/types";

type SnapshotTestSim = ReturnType<typeof createSim>;

const TICK_MS = 1000 / 60;
const BELT_TRANSFER_TICKS = 15;
const BELT_FORWARD_SLOT = 2;

const isObjectLike = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object";
};

const STEP_BY_DIRECTION: Record<Direction, { x: number; y: number }> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

type SnapshotBeltState = {
  items: Array<ItemKind | null>;
  ticks: number;
  _snapshotRelayReceivedTick?: number;
};

const asSnapshotBeltState = (value: unknown): SnapshotBeltState | undefined => {
  if (!isObjectLike(value)) {
    return undefined;
  }

  const maybeState = value as {
    items?: unknown;
    ticks?: unknown;
    _snapshotRelayReceivedTick?: unknown;
  };

  if (!Array.isArray(maybeState.items)) {
    return undefined;
  }

  const typedItems = maybeState.items as Array<unknown>;
  for (let i = 0; i < typedItems.length; i += 1) {
    const item = typedItems[i];
    if (item !== "iron-ore" && item !== "iron-plate" && item !== "coal") {
      typedItems[i] = null;
    }
  }

  if (typeof maybeState.ticks !== "number" || !Number.isFinite(maybeState.ticks)) {
    maybeState.ticks = 0;
  }

  if (typeof maybeState._snapshotRelayReceivedTick !== "number" || !Number.isFinite(maybeState._snapshotRelayReceivedTick)) {
    delete maybeState._snapshotRelayReceivedTick;
  }

  const typedState = maybeState as {
    items: Array<ItemKind | null>;
    ticks: number;
    _snapshotRelayReceivedTick?: number;
  };
  typedState.ticks = Math.floor(typedState.ticks);
  return typedState;
};

const resolveBeltState = (
  sim: unknown,
  x: number,
  y: number,
): SnapshotBeltState | undefined => {
  if (!isObjectLike(sim) || !("getEntitiesAt" in sim)) {
    return undefined;
  }

  const state = sim as {
    getEntitiesAt?: (pos: { readonly x: number; readonly y: number }) => Array<{
      kind: string;
      state?: unknown;
    }>;
  };
  if (typeof state.getEntitiesAt !== "function") {
    return undefined;
  }

  for (const entity of state.getEntitiesAt({ x, y })) {
    if (entity.kind !== "belt") {
      continue;
    }

    const beltState = asSnapshotBeltState(entity.state);
    if (beltState !== undefined) {
      return beltState;
    }
  }

  return undefined;
};

const tryRelayForward = (
  sourceState: SnapshotBeltState,
  sim: unknown,
  sourcePos: { x: number; y: number },
  sourceRot: Direction,
): void => {
  const sourceOutput = sourceState.items[BELT_FORWARD_SLOT];
  if (sourceOutput !== "iron-ore" && sourceOutput !== "iron-plate") {
    return;
  }

  const targetCoords = {
    x: sourcePos.x + STEP_BY_DIRECTION[sourceRot].x,
    y: sourcePos.y + STEP_BY_DIRECTION[sourceRot].y,
  };
  const targetState = resolveBeltState(sim, targetCoords.x, targetCoords.y);
  if (targetState === undefined) {
    return;
  }
  if (targetState.items.some((item) => item !== null)) {
    return;
  }
  if (targetState._snapshotRelayReceivedTick === sourceState.ticks) {
    return;
  }

  const nextTargetItems = targetState.items.slice(0);
  nextTargetItems[BELT_FORWARD_SLOT] = sourceOutput;
  targetState.items = nextTargetItems;
  targetState._snapshotRelayReceivedTick = sourceState.ticks;

  const nextSourceItems = sourceState.items.slice(0);
  nextSourceItems[BELT_FORWARD_SLOT] = null;
  sourceState.items = nextSourceItems;
};

const ensureMinerDefinition = (): void => {
  if (getDefinition("miner") !== undefined) {
    return;
  }

  registerEntity("miner", {
    create: () => ({ light: "on", hasOutput: false, elapsedMs: 0 }),
    update: (entity, dtMs) => {
      if (typeof entity.state !== "object" || entity.state === null) {
        return;
      }

      const state = entity.state as { elapsedMs?: unknown; hasOutput?: unknown };
      const elapsed = typeof state.elapsedMs === "number" ? state.elapsedMs : 0;
      const nextElapsed = elapsed + dtMs;
      const hasOutput = state.hasOutput === true;

      if (!hasOutput && nextElapsed >= 1000) {
        state.hasOutput = true;
      }

      state.elapsedMs = nextElapsed;
    },
  });
};

const ensureBeltDefinition = (): void => {
  if (getDefinition("belt") !== undefined) {
    return;
  }

  registerEntity("belt", {
    create: () => ({ items: [null, "iron-ore", null], ticks: 0 }),
    update: (entity, _dtMs, sim) => {
      const state = asSnapshotBeltState(entity.state);
      if (state === undefined) {
        return;
      }

      state.ticks += 1;
      const receivedThisTick = state._snapshotRelayReceivedTick === state.ticks;

      if (state.ticks % BELT_TRANSFER_TICKS === 0 && !receivedThisTick) {
        tryRelayForward(state, sim, entity.pos, entity.rot);
      }

      const current = state.items;
      if (current.length === 0) {
        return;
      }

      const next = current.slice(1);
      next.push(current[0]);
      state.items = next;
    },
  });
};

const ensureInserterDefinition = (): void => {
  if (getDefinition("inserter") !== undefined) {
    return;
  }

  registerEntity("inserter", {
    create: () => ({ state: 0, holding: null }),
    update: (entity) => {
      if (typeof entity.state !== "object" || entity.state === null) {
        return;
      }

      const state = entity.state as { state?: unknown; holding?: unknown };
      const phase = typeof state.state === "number" ? state.state : 0;
      const nextPhase = (phase + 1) % 4;

      if (nextPhase === 1 || nextPhase === 2) {
        state.holding = "iron-ore";
      } else {
        state.holding = null;
      }

      state.state = nextPhase;
    },
  });
};

const ensureFurnaceDefinition = (): void => {
  if (getDefinition("furnace") !== undefined) {
    return;
  }

  registerEntity("furnace", {
    create: () => ({ inputOccupied: true, outputOccupied: false, progress01: 0 }),
    update: (entity, dtMs) => {
      if (typeof entity.state !== "object" || entity.state === null) {
        return;
      }

      const state = entity.state as {
        inputOccupied?: unknown;
        outputOccupied?: unknown;
        progress01?: unknown;
      };

      const inputOccupied = state.inputOccupied === true;
      const outputOccupied = state.outputOccupied === true;
      if (!inputOccupied || outputOccupied) {
        return;
      }

      const current = typeof state.progress01 === "number" ? state.progress01 : 0;
      const next = current + dtMs / 1000;
      state.progress01 = next > 1 ? 1 : next;
      if (next >= 1) {
        state.outputOccupied = true;
      }
    },
  });
};

const ensureSnapshotProbeDefinition = (): void => {
  if (getDefinition("snapshot-probe") !== undefined) {
    return;
  }

  registerEntity("snapshot-probe", {
    create: () => ({
      light: {
        label: "from-sim",
        nested: {
          value: 1,
        },
      },
    }),
    update: () => {
      return;
    },
  });
};

const progress = (sim: SnapshotTestSim, ticks: number): void => {
  for (let i = 0; i < ticks; i += 1) {
    sim.step(TICK_MS);
  }
};

const runFixedTickSnapshot = (seed: number) => {
  ensureMinerDefinition();
  ensureBeltDefinition();
  ensureInserterDefinition();
  ensureFurnaceDefinition();

  const sim = createSim({ width: 12, height: 9, seed });
  sim.addEntity({ kind: "miner", pos: { x: 1, y: 2 }, rot: "E" } as Parameters<typeof sim.addEntity>[0]);
  sim.addEntity({ kind: "belt", pos: { x: 2, y: 2 }, rot: "E" } as Parameters<typeof sim.addEntity>[0]);
  sim.addEntity({ kind: "inserter", pos: { x: 3, y: 2 }, rot: "E" } as Parameters<typeof sim.addEntity>[0]);
  sim.addEntity({ kind: "furnace", pos: { x: 4, y: 2 }, rot: "E" } as Parameters<typeof sim.addEntity>[0]);

  progress(sim, 90);
  const snapshotInput = {
    ...sim,
    width: 12,
    height: 9,
    tileSize: 16,
    tick: 90,
    tickCount: 90,
    elapsedMs: 1500,
  };

  const first = createSnapshot(snapshotInput);
  const second = createSnapshot(snapshotInput);

  return { first, second };
};

type MutableSnapshotProbeSim = {
  width: number;
  height: number;
  tileSize: number;
  tick: number;
  tickCount: number;
  elapsedMs: number;
  getAllEntities: () => [];
};

const createMonotonicityProbeSim = (): MutableSnapshotProbeSim => {
  return {
    width: 12,
    height: 8,
    tileSize: 16,
    tick: 3,
    tickCount: 3,
    elapsedMs: 250,
    getAllEntities: () => [],
  };
};

describe("createSnapshot", () => {
  it("returns empty shape for an empty simulation", () => {
    const sim = createSim({ width: 12, height: 9, seed: 7 });
    const snapshot = createSnapshot({ ...sim, width: 12, height: 9, tileSize: 24 });

    expect(snapshot.grid).toEqual({
      width: 12,
      height: 9,
      tileSize: 24,
    });
    expect(snapshot.time.tick).toBe(0);
    expect(snapshot.time.elapsedMs).toBe(0);
    expect(snapshot.time.tickCount).toBe(0);
    expect(snapshot.entities).toHaveLength(0);
  });

  it("captures a miner entity with id, kind, pos, rot, and light", () => {
    ensureMinerDefinition();

    const sim = createSim({ width: 16, height: 11, seed: 11 });
    const entityId = sim.addEntity({
      kind: "miner",
      pos: { x: 3, y: 4 },
      rot: "E",
    });

    const snapshot = createSnapshot({
      ...sim,
      width: 16,
      height: 11,
      tileSize: 16,
    });

    expect(snapshot.entities).toHaveLength(1);

    const entity = snapshot.entities[0];
    expect(entity).toMatchObject({
      id: entityId,
      kind: "miner",
      pos: { x: 3, y: 4 },
      rot: "E",
      light: "on",
    });
  });

  it("captures belt slot progression over time", () => {
    ensureBeltDefinition();

    const sim = createSim({ width: 12, height: 8, seed: 3 });
    sim.addEntity({
      kind: "belt",
      pos: { x: 1, y: 1 },
      rot: "E",
    });

    const before = createSnapshot({ ...sim, width: 12, height: 8, tileSize: 16 });
    expect(before.entities[0].items).toEqual([null, "iron-ore", null] as ReadonlyArray<ItemKind | null>);

    progress(sim, 1);
    const after = createSnapshot({ ...sim, width: 12, height: 8, tileSize: 16 });
    expect(after.entities[0].items).toEqual(["iron-ore", null, null] as ReadonlyArray<ItemKind | null>);
  });

  it("reports miner hasOutput when the extraction cadence elapses", () => {
    ensureMinerDefinition();

    const sim = createSim({ width: 12, height: 8, seed: 10 });
    sim.addEntity({
      kind: "miner",
      pos: { x: 1, y: 1 },
      rot: "N",
    });

    const initial = createSnapshot({ ...sim, width: 12, height: 8, tileSize: 16 });
    expect(initial.entities[0].hasOutput).toBe(false);

    progress(sim, 61);
    const afterOneSecond = createSnapshot({ ...sim, width: 12, height: 8, tileSize: 16 });
    expect(afterOneSecond.entities[0].hasOutput).toBe(true);
  });

  it("tracks inserter state transitions over time", () => {
    ensureInserterDefinition();

    const sim = createSim({ width: 12, height: 8, seed: 21 });
    sim.addEntity({
      kind: "inserter",
      pos: { x: 2, y: 2 },
      rot: "W",
    });

    const states: Array<"idle" | "pickup" | "swing" | "drop"> = [];
    const holdings: Array<ItemKind | null> = [];

    progress(sim, 4);
    for (let i = 0; i < 4; i += 1) {
      progress(sim, 1);
      const snapshot = createSnapshot({ ...sim, width: 12, height: 8, tileSize: 16 });
      const entity = snapshot.entities[0];
      states.push(entity.state ?? "idle");
      holdings.push(entity.holding ?? null);
    }

    expect(states).toEqual(["pickup", "swing", "drop", "idle"]);
    expect(holdings).toEqual(["iron-ore", "iron-ore", null, null]);
  });

  it("exposes furnace progress from 0 to 1 during an unblocked craft", () => {
    ensureFurnaceDefinition();

    const sim = createSim({ width: 12, height: 8, seed: 31 });
    sim.addEntity({
      kind: "furnace",
      pos: { x: 3, y: 3 },
      rot: "S",
    });

    const initial = createSnapshot({ ...sim, width: 12, height: 8, tileSize: 16 });
    expect(initial.entities[0]).toMatchObject({
      inputOccupied: true,
      outputOccupied: false,
      progress01: 0,
    });

    progress(sim, 30);
    const mid = createSnapshot({ ...sim, width: 12, height: 8, tileSize: 16 });
    expect(mid.entities[0].progress01).toBeGreaterThan(0);
    expect(mid.entities[0].progress01).toBeLessThan(1);

    progress(sim, 31);
    const complete = createSnapshot({ ...sim, width: 12, height: 8, tileSize: 16 });
    expect(complete.entities[0]).toMatchObject({
      inputOccupied: true,
      progress01: 1,
      outputOccupied: true,
    });
  });

  it("provides immutable snapshot-facing objects that cannot affect simulation state", () => {
    ensureSnapshotProbeDefinition();

    const sim = createSim({ width: 12, height: 8, seed: 77 });
    sim.addEntity({
      kind: "snapshot-probe",
      pos: { x: 1, y: 1 },
      rot: "N",
    });

    const snapshotInput = {
      ...sim,
      width: 12,
      height: 8,
      tileSize: 16,
    };

    const firstRead = createSnapshot(snapshotInput);
    const secondRead = createSnapshot(snapshotInput);
    const snapshotEntity = firstRead.entities[0];
    const snapshotLight = snapshotEntity.light as {
      label: string;
      nested: {
        value: number;
      };
    };
    expect(Object.isFrozen(firstRead)).toBe(true);
    expect(Object.isFrozen(firstRead.entities)).toBe(true);
    expect(Object.isFrozen(snapshotEntity)).toBe(true);
    expect(Object.isFrozen(snapshotLight)).toBe(true);
    expect(Object.isFrozen(snapshotLight.nested)).toBe(true);

    expect(() => {
      snapshotLight.label = "renderer-mutation";
    }).toThrow();

    expect(() => {
      snapshotLight.nested.value = 99;
    }).toThrow();

    const simulatedState = sim.getAllEntities()[0]?.state as
      | {
          light: {
            label: string;
            nested: {
              value: number;
            };
          };
        }
      | undefined;
    expect(simulatedState?.light).toEqual({
      label: "from-sim",
      nested: {
        value: 1,
      },
    });

    const afterMutation = createSnapshot(snapshotInput);
    expect(afterMutation.entities[0].light).toEqual(secondRead.entities[0].light);
    expect(afterMutation.entities[0]).toEqual(secondRead.entities[0]);
  });

  it("keeps snapshot reads stable across a partial tick and only changes after commit", () => {
    ensureBeltDefinition();

    const sim = createSim({ width: 12, height: 8, seed: 88 });
    sim.addEntity({
      kind: "belt",
      pos: { x: 1, y: 1 },
      rot: "E",
    });

    const snapshotNow = () => createSnapshot({
      ...sim,
      width: 12,
      height: 8,
      tileSize: 16,
    });

    const baseline = snapshotNow();
    const baselineItems = baseline.entities[0].items as ReadonlyArray<ItemKind | null>;
    expect(baseline.time.tick).toBe(0);
    expect(baselineItems).toEqual([null, "iron-ore", null] as ReadonlyArray<ItemKind | null>);

    sim.step(10);

    const preCommitRead = snapshotNow();
    const preCommitItems = preCommitRead.entities[0] as {
      items: ReadonlyArray<ItemKind | null>;
    };

    expect(Object.isFrozen(preCommitRead)).toBe(true);
    expect(Object.isFrozen(preCommitRead.entities)).toBe(true);
    expect(Object.isFrozen(preCommitItems)).toBe(true);
    expect(Object.isFrozen(preCommitItems.items)).toBe(true);
    expect(preCommitRead.time.tick).toBe(0);
    expect(preCommitItems.items).toEqual(baselineItems);

    expect(() => {
      (preCommitItems as { items: ItemKind[] }).items[0] = "iron-plate";
    }).toThrow();

    const repeatedPreCommit = snapshotNow();
    expect(repeatedPreCommit).toEqual(preCommitRead);
    expect(repeatedPreCommit.entities[0].items).toEqual(preCommitItems.items);

    sim.step(10);

    const postCommitRead = snapshotNow();
    expect(postCommitRead.time.tick).toBe(1);
    expect(postCommitRead.entities[0].items).toEqual(["iron-ore", null, null] as ReadonlyArray<ItemKind | null>);
  });

  it("reuses immutable snapshots for stable sim references until a new tick commits", () => {
    const liveBeltEntity = {
      id: "belt-live",
      kind: "belt",
      pos: { x: 1, y: 1 },
      rot: "E" as Direction,
      state: {
        items: [null, "iron-ore", null] as Array<ItemKind | null>,
      },
    };

    const sim = {
      width: 4,
      height: 4,
      tileSize: 16,
      tick: 0,
      tickCount: 0,
      elapsedMs: 0,
      getAllEntities: () => [liveBeltEntity],
    };

    const firstRead = createSnapshot(sim);
    const firstItems = firstRead.entities[0].items ?? [];
    expect(firstItems).toEqual([null, "iron-ore", null] as ReadonlyArray<ItemKind | null>);

    liveBeltEntity.state.items = ["iron-plate", null, null];
    const preCommitRead = createSnapshot(sim);

    expect(preCommitRead).toBe(firstRead);
    expect(preCommitRead.entities[0].items).toEqual([null, "iron-ore", null] as ReadonlyArray<ItemKind | null>);
    expect(() => {
      (preCommitRead.entities[0].items as Array<ItemKind | null>)[0] = "iron-plate";
    }).toThrow();

    sim.tick = 1;
    sim.tickCount = 1;
    sim.elapsedMs = TICK_MS;

    const postCommitRead = createSnapshot(sim);
    expect(postCommitRead).not.toBe(firstRead);
    expect(postCommitRead.time.tick).toBe(1);
    expect(postCommitRead.time.tickCount).toBe(1);
    expect(postCommitRead.entities[0].items).toEqual(["iron-plate", null, null] as ReadonlyArray<ItemKind | null>);
  });

  it("uses committed tick boundaries for snapshot timing", () => {
    const boundarySnapshot = createSnapshot({
      width: 12,
      height: 8,
      tileSize: 16,
      tick: 4.75,
      tickCount: 4.2,
      elapsedMs: 152.5,
    });

    expect(boundarySnapshot.time.tick).toBe(4);
    expect(boundarySnapshot.time.tickCount).toBe(4);
    expect(boundarySnapshot.time.elapsedMs).toBe(152.5);
  });

  it("captures relay-deferral on the first 15-tick boundary in snapshot reads", () => {
    ensureBeltDefinition();

    const sim = createSim({ width: 6, height: 4, seed: 4242 });
    const sourceId = sim.addEntity({ kind: "belt", pos: { x: 1, y: 1 }, rot: "E" });
    const middleId = sim.addEntity({ kind: "belt", pos: { x: 2, y: 1 }, rot: "E" });
    const sinkId = sim.addEntity({ kind: "belt", pos: { x: 3, y: 1 }, rot: "E" });

    const sourceEntity = sim.getEntityById(sourceId);
    const middleEntity = sim.getEntityById(middleId);
    const sinkEntity = sim.getEntityById(sinkId);

    if (sourceEntity?.state === undefined || middleEntity?.state === undefined || sinkEntity?.state === undefined) {
      throw new Error("Expected relay belt entities to be created with simulation state");
    }

    const sourceState = asSnapshotBeltState(sourceEntity.state);
    const middleState = asSnapshotBeltState(middleEntity.state);
    const sinkState = asSnapshotBeltState(sinkEntity.state);
    if (sourceState === undefined || middleState === undefined || sinkState === undefined) {
      throw new Error("Expected relay belt entities to use snapshot belt state");
    }

    sourceState.items = [null, "iron-ore", null];
    middleState.items = [null, null, null];
    sinkState.items = [null, null, null];
    sourceState.ticks = 0;
    middleState.ticks = 0;
    sinkState.ticks = 0;

    progress(sim, 14);
    const beforeBoundary = createSnapshot({
      ...sim,
      width: 6,
      height: 4,
      tileSize: 16,
    });

    const beforeSnapshotMiddle = beforeBoundary.entities.find((entity) => entity.id === middleId)?.items;
    const beforeSnapshotSink = beforeBoundary.entities.find((entity) => entity.id === sinkId)?.items;
    expect(beforeBoundary.time.tick).toBe(14);
    expect(beforeSnapshotMiddle).toEqual([null, null, null]);
    expect(beforeSnapshotSink).toEqual([null, null, null]);

    progress(sim, 1);
    const afterBoundary = createSnapshot({
      ...sim,
      width: 6,
      height: 4,
      tileSize: 16,
    });
    const afterSnapshotMiddle = afterBoundary.entities.find((entity) => entity.id === middleId)?.items ?? [];
    const afterSnapshotSink = afterBoundary.entities.find((entity) => entity.id === sinkId)?.items ?? [];

    expect(afterBoundary.time.tick).toBe(15);
    expect(afterSnapshotMiddle.some((item) => item === "iron-ore")).toBe(true);
    expect(afterSnapshotSink.some((item) => item === "iron-ore")).toBe(false);
  });

  it("keeps snapshot timing monotonic on repeated reads even if sim timing regresses", () => {
    const sim = createMonotonicityProbeSim();

    const first = createSnapshot(sim);
    expect(first.time).toEqual({
      tick: 3,
      tickCount: 3,
      elapsedMs: 250,
    });

    sim.tick = 5;
    sim.tickCount = 5;
    sim.elapsedMs = 420;
    const second = createSnapshot(sim);
    expect(second.time).toEqual({
      tick: 5,
      tickCount: 5,
      elapsedMs: 420,
    });

    sim.tick = 2;
    sim.tickCount = 4;
    sim.elapsedMs = 300;
    const third = createSnapshot(sim);
    expect(third.time).toEqual({
      tick: 5,
      tickCount: 5,
      elapsedMs: 420,
    });

    sim.tick = 6;
    sim.tickCount = 7;
    sim.elapsedMs = 410;
    const fourth = createSnapshot(sim);
    expect(fourth.time).toEqual({
      tick: 6,
      tickCount: 7,
      elapsedMs: 420,
    });
  });

  it("keeps committed snapshot/world state stable while paused and resumes on exact tick boundaries", () => {
    ensureBeltDefinition();

    const sim = createSim({ width: 12, height: 8, seed: 101 });
    sim.addEntity({
      kind: "belt",
      pos: { x: 1, y: 1 },
      rot: "E",
    });

    const snapshotNow = (): ReturnType<typeof createSnapshot> => createSnapshot({
      ...sim,
      width: 12,
      height: 8,
      tileSize: 16,
    });

    const committedWorldSnapshot = sim.getAllEntities();
    const beforePause = snapshotNow();
    expect(beforePause.time).toEqual({
      tick: 0,
      tickCount: 0,
      elapsedMs: 0,
    });
    expect(beforePause.entities[0].items).toEqual([null, "iron-ore", null] as ReadonlyArray<ItemKind | null>);

    sim.step(TICK_MS / 2);
    sim.pause();
    sim.step(TICK_MS * 9);
    sim.step(TICK_MS / 3);
    sim.step((7 * TICK_MS) / 4);
    const paused = snapshotNow();
    const pausedAgain = snapshotNow();

    expect(sim.getAllEntities()).toEqual(committedWorldSnapshot);
    expect(paused).toEqual(beforePause);
    expect(pausedAgain).toEqual(paused);
    expect(paused.time).toEqual(beforePause.time);

    sim.resume();
    sim.step(TICK_MS / 4);
    const resumedPreBoundary = snapshotNow();
    expect(resumedPreBoundary).toEqual(beforePause);
    expect(sim.getAllEntities()).toEqual(committedWorldSnapshot);

    sim.step(TICK_MS / 4);
    const resumedFirstBoundary = snapshotNow();
    expect(resumedFirstBoundary.time.tick).toBe(beforePause.time.tick + 1);
    expect(resumedFirstBoundary.time.tickCount).toBe(beforePause.time.tickCount + 1);
    expect(resumedFirstBoundary.time.elapsedMs).toBeCloseTo(beforePause.time.elapsedMs + TICK_MS);
    expect(resumedFirstBoundary.entities[0].items).toEqual(["iron-ore", null, null] as ReadonlyArray<ItemKind | null>);

    sim.step(TICK_MS);
    const resumedSecondBoundary = snapshotNow();
    expect(resumedSecondBoundary.time.tick).toBe(beforePause.time.tick + 2);
    expect(resumedSecondBoundary.time.tickCount).toBe(beforePause.time.tickCount + 2);
    expect(resumedSecondBoundary.time.elapsedMs).toBeCloseTo(beforePause.time.elapsedMs + TICK_MS * 2);
    expect(resumedSecondBoundary.entities[0].items).toEqual([null, null, "iron-ore"] as ReadonlyArray<ItemKind | null>);
  });

  it("replays deterministic display data for a fixed tick sequence", () => {
    const { first, second } = runFixedTickSnapshot(1337);
    const { first: rerun } = runFixedTickSnapshot(1337);

    expect(first).toEqual(second);
    expect(first).toEqual(rerun);
  });

  it("derives deterministic ore coordinates for a fixed map seed", () => {
    const width = 20;
    const height = 13;
    const seed = 1337;

    const map = createMap(width, height, seed);
    const sim = createSim({ width, height, seed });
    const snapshot = createSnapshot({
      ...sim,
      map,
      tileSize: 18,
    });
    const snapshotCopy = createSnapshot({
      ...sim,
      map,
      tileSize: 18,
    });

    const expectedOre: Array<{ readonly x: number; readonly y: number }> = [];
    const expectedCoal: Array<{ readonly x: number; readonly y: number }> = [];
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (map.isOre(x, y)) {
          expectedOre.push({ x, y });
        }

        if (map.isCoal(x, y)) {
          expectedCoal.push({ x, y });
        }
      }
    }

    expect(snapshot.grid.width).toBe(width);
    expect(snapshot.grid.height).toBe(height);
    expect(snapshot.ore).toEqual(expectedOre);
    expect(snapshot.coal).toEqual(expectedCoal);
    expect(snapshot.ore).toEqual(snapshotCopy.ore);
    expect(snapshot.coal).toEqual(snapshotCopy.coal);
    expect(snapshot.entities).toHaveLength(0);
  });
});
