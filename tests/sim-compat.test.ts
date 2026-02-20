import { describe, expect, it } from "vitest";

import { registerEntity } from "../src/core/registry";
import { createSim } from "../src/core/sim";
import { rotateDirection } from "../src/core/types";
import { attachInput } from "../src/ui/input";

const TICK_MS = 1000 / 60;

const COMPAT_KIND = "compat-probe-entity";

let definitionRegistered = false;

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

      sim.step(TICK_MS / 2);
      expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(1);

      sim.step(TICK_MS * 2 + TICK_MS / 2);
      expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(3);

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

    sim.step(TICK_MS * 2 + TICK_MS / 2);
    expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(2);
    const pausedTickCount = sim.tickCount;
    const pausedElapsedMs = sim.elapsedMs;

    sim.pause();
    sim.step(TICK_MS * 3);
    sim.step(TICK_MS / 2);
    expect(sim.tickCount).toBe(pausedTickCount);
    expect(sim.elapsedMs).toBe(pausedElapsedMs);
    expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(pausedTickCount);

    sim.resume();
    sim.step(TICK_MS / 2);
    expect(sim.tickCount).toBe(pausedTickCount);
    expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(pausedTickCount);

    sim.step(TICK_MS / 2 + TICK_MS);
    expect(sim.tickCount).toBe(pausedTickCount + 1);
    expect((sim.getEntityById(id)?.state as { ticks?: number } | undefined)?.ticks).toBe(pausedTickCount + 1);
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

    const id = sim.addEntity(COMPAT_KIND, {
      kind: COMPAT_KIND,
      pos: { x: 1, y: 1 },
      rot: "N",
    } as Parameters<typeof sim.addEntity>[0]);
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
    stage.emit("keydown", { code: "KeyR", repeat: true });
    stage.emit("keydown", { key: "r", repeat: false });
    stage.emit("keydown", { key: "R", repeat: false });

    expect(entity?.rot).toBe("W");

    stopRotate();
    stage.emit("keydown", { code: "KeyR", repeat: false });
    expect(entity?.rot).toBe("W");

    controller.destroy();
  });
});
