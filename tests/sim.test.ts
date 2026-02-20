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
