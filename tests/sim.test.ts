import { getDefinition, registerEntity } from "../src/core/registry";
import { createSim } from "../src/core/sim";
import { attachInput } from "../src/ui/input";
import { rotateDirection, DIRECTION_SEQUENCE, type Direction } from "../src/core/types";

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
});
