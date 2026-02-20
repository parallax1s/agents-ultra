import { describe, expect, it } from "vitest";

import { createMap } from "../src/core/map";
import { createSim } from "../src/core/sim";
import { registerEntity, getDefinition } from "../src/core/registry";
import { createSnapshot } from "../src/core/snapshot";
import type { ItemKind } from "../src/core/types";

type SnapshotTestSim = ReturnType<typeof createSim>;

const TICK_MS = 1000 / 60;

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
    create: () => ({ items: [null, "iron-ore", null] }),
    update: (entity) => {
      if (typeof entity.state !== "object" || entity.state === null) {
        return;
      }

      const state = entity.state as { items?: unknown };
      if (!Array.isArray(state.items)) {
        return;
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

  it("keeps same-tick snapshot reads repeatable when renderer mutates returned data", () => {
    ensureBeltDefinition();

    const sim = createSim({ width: 12, height: 8, seed: 88 });
    sim.addEntity({
      kind: "belt",
      pos: { x: 1, y: 1 },
      rot: "E",
    });

    const snapshotInput = {
      ...sim,
      width: 12,
      height: 8,
      tileSize: 16,
    };
    const firstRenderRead = createSnapshot(snapshotInput);
    const baseline = createSnapshot(snapshotInput);
    const renderedItems = firstRenderRead.entities[0] as {
      items: ReadonlyArray<ItemKind | null>;
    };
    expect(Object.isFrozen(firstRenderRead)).toBe(true);
    expect(Object.isFrozen(firstRenderRead.entities)).toBe(true);
    expect(Object.isFrozen(renderedItems)).toBe(true);

    expect(() => {
      renderedItems[0] = "iron-plate";
    }).toThrow();
    expect(() => {
      (renderedItems as unknown as ItemKind[]).push("iron-ore");
    }).toThrow();

    const secondRenderRead = createSnapshot(snapshotInput);
    expect(secondRenderRead).toEqual(baseline);
    expect(secondRenderRead.entities[0].items).toEqual(baseline.entities[0].items);
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
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (map.isOre(x, y)) {
          expectedOre.push({ x, y });
        }
      }
    }

    expect(snapshot.grid.width).toBe(width);
    expect(snapshot.grid.height).toBe(height);
    expect(snapshot.ore).toEqual(expectedOre);
    expect(snapshot.ore).toEqual(snapshotCopy.ore);
    expect(snapshot.entities).toHaveLength(0);
  });
});
