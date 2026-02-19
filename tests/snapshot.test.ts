import { describe, expect, it } from "vitest";

import { createMap } from "../src/core/map";
import { createSim } from "../src/core/sim";
import { registerEntity, getDefinition } from "../src/core/registry";
import { createSnapshot } from "../src/core/snapshot";

const ensureMinerDefinition = (): void => {
  if (getDefinition("miner") !== undefined) {
    return;
  }

  registerEntity("miner", {
    create: () => ({ light: "on" }),
    update: () => {
      // no-op
    },
  });
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

  it("captures a miner entity with id, kind, pos, and rot", () => {
    ensureMinerDefinition();

    const sim = createSim({ width: 16, height: 11, seed: 11 });
    const entityId = sim.addEntity({ kind: "miner", pos: { x: 3, y: 4 }, rot: "E" });

    const snapshot = createSnapshot({
      ...sim,
      width: 16,
      height: 11,
      tileSize: 16,
    });

    expect(snapshot.entities).toHaveLength(1);

    const entity = snapshot.entities[0];
    expect(entity).toEqual({
      id: entityId,
      kind: "miner",
      pos: { x: 3, y: 4 },
      rot: "E",
      light: "on",
    });
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
