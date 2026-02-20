import { describe, expect, it } from "vitest";

import { createMap } from "../src/core/map";
import {
  createPlacementController,
  type EntityKind,
  type Rotation,
  type Tile,
  type Simulation,
} from "../src/ui/placement";

function snapshotTiles(width: number, height: number, seed: number | string): string {
  const map = createMap(width, height, seed);
  let output = "";

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      output += map.isOre(x, y) ? "1" : "0";
    }
  }

  return output;
}

function tileKey(tile: Tile): string {
  return `${tile.x},${tile.y}`;
}

type PlacementFixture = {
  map: ReturnType<typeof createMap>;
  sim: Simulation;
  snapshotPlaced: () => string;
  canPlaceReason: (kind: EntityKind, tile: Tile, rotation?: Rotation) => string;
  canRemoveReason: (tile: Tile) => string;
};

function firstTile(
  map: ReturnType<typeof createMap>,
  width: number,
  height: number,
  predicate: (x: number, y: number) => boolean,
): Tile {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (predicate(x, y)) {
        return { x, y };
      }
    }
  }

  throw new Error("No tile matched predicate");
}

function createPlacementFixture(seed: number | string = 1337, width = 20, height = 20): PlacementFixture {
  const map = createMap(width, height, seed);
  const occupied = new Set<string>();
  let lastPlacementSnapshot = "";

  const resolvePlacementReason = (kind: EntityKind, tile: Tile, _rotation: Rotation): string => {
    if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y)) {
      return "out-of-bounds";
    }

    if (tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= height) {
      return "out-of-bounds";
    }

    if (occupied.has(tileKey(tile))) {
      return "occupied";
    }

    if (kind === "Miner" && !map.isOre(tile.x, tile.y)) {
      return "invalid-miner-on-resource";
    }

    return "ok";
  };

  const resolveRemovalReason = (tile: Tile): string => {
    if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y)) {
      return "out-of-bounds";
    }

    if (tile.x < 0 || tile.y < 0 || tile.x >= width || tile.y >= height) {
      return "out-of-bounds";
    }

    if (!occupied.has(tileKey(tile))) {
      if (map.isOre(tile.x, tile.y)) {
        return "non-removable-resource";
      }
      return "empty";
    }

    return "ok";
  };

  const isOccupied = (tile: Tile): boolean => occupied.has(tileKey(tile));

  const snapshotPlaced = (): string => {
    const current = Array.from(occupied).sort().join("|");
    lastPlacementSnapshot = current;
    return current;
  };

  const sim: Simulation = {
    canPlace(kind, tile, _rotation) {
      return resolvePlacementReason(kind, tile, _rotation) === "ok";
    },
    addEntity(kind, tile, _rotation) {
      if (!sim.canPlace(kind, tile, _rotation)) {
        return;
      }

      occupied.add(tileKey(tile));
      snapshotPlaced();
    },
    removeEntity(tile) {
      const key = tileKey(tile);
      if (!occupied.delete(key)) {
        return;
      }

      snapshotPlaced();
    },
    canRemove(tile) {
      return resolveRemovalReason(tile) === "ok";
    },
    hasEntityAt: isOccupied,
    isResourceTile: (tile) => map.isOre(tile.x, tile.y),
  };

  return {
    map,
    sim,
    snapshotPlaced,
    canPlaceReason(kind, tile, rotation = 0) {
      return resolvePlacementReason(kind, tile, rotation);
    },
    canRemoveReason(tile) {
      return resolveRemovalReason(tile);
    },
  };
}

describe("createMap", () => {
  it("is deterministic for the same seed", () => {
    const first = snapshotTiles(64, 64, 1337);
    const second = snapshotTiles(64, 64, 1337);
    expect(first).toBe(second);
  });

  it("differs when using different seeds", () => {
    const first = snapshotTiles(64, 64, 1337);
    const second = snapshotTiles(64, 64, 7331);
    expect(first).not.toBe(second);
  });

  it("keeps the center spawn area ore-free (at least 10x10)", () => {
    const width = 60;
    const height = 40;
    const map = createMap(width, height, 99);

    const spawnWidth = 10;
    const spawnHeight = 10;
    const startX = Math.floor((width - spawnWidth) / 2);
    const startY = Math.floor((height - spawnHeight) / 2);

    for (let y = startY; y < startY + spawnHeight; y += 1) {
      for (let x = startX; x < startX + spawnWidth; x += 1) {
        expect(map.isOre(x, y)).toBe(false);
        expect(map.getTile(x, y)).toBe("empty");
      }
    }
  });

  it("handles bounds and non-integer lookups safely", () => {
    const map = createMap(20, 20, 123);

    expect(map.getTile(-1, 0)).toBeUndefined();
    expect(map.getTile(0, -1)).toBeUndefined();
    expect(map.getTile(20, 0)).toBeUndefined();
    expect(map.getTile(0, 20)).toBeUndefined();
    expect(map.getTile(0.5, 1)).toBeUndefined();
    expect(map.getTile(1, 0.5)).toBeUndefined();

    expect(map.isOre(-1, 0)).toBe(false);
    expect(map.isOre(0, -1)).toBe(false);
    expect(map.isOre(20, 0)).toBe(false);
    expect(map.isOre(0, 20)).toBe(false);
    expect(map.isOre(0.5, 1)).toBe(false);
    expect(map.isOre(1, 0.5)).toBe(false);
  });

  it("exposes stable bounds checks", () => {
    const map = createMap(20, 20, 123);

    expect(map.isWithinBounds(0, 0)).toBe(true);
    expect(map.isWithinBounds(19, 19)).toBe(true);
    expect(map.isWithinBounds(-1, 0)).toBe(false);
    expect(map.isWithinBounds(0, -1)).toBe(false);
    expect(map.isWithinBounds(20, 0)).toBe(false);
    expect(map.isWithinBounds(0, 20)).toBe(false);
    expect(map.isWithinBounds(0.5, 1)).toBe(false);
    expect(map.isWithinBounds(1, 0.5)).toBe(false);
  });
});

describe("placement controller validation", () => {
  it("deterministically handles occupied targets and repeated placement/removal", () => {
    const runSequence = (): { snapshots: string[]; reasons: string[] } => {
      const width = 20;
      const height = 20;
      const { sim, map, snapshotPlaced, canPlaceReason, canRemoveReason } = createPlacementFixture(1337, width, height);
      const tile = firstTile(map, width, height, (x, y) => map.isOre(x, y));
      const snapshots: string[] = [];
      const reasons: string[] = [];

      const controller = createPlacementController(sim);

      controller.selectKind("Miner");
      controller.setCursor(tile);
      snapshots.push(snapshotPlaced());
      reasons.push(canPlaceReason("Miner", tile));

      controller.clickLMB();
      reasons.push(canPlaceReason("Miner", tile));
      snapshots.push(snapshotPlaced());

      controller.clickLMB();
      reasons.push(canPlaceReason("Miner", tile));
      snapshots.push(snapshotPlaced());

      controller.selectKind("Belt");
      reasons.push(canRemoveReason(tile));
      controller.clickRMB();
      reasons.push(canRemoveReason(tile));
      snapshots.push(snapshotPlaced());

      controller.clickRMB();
      reasons.push(canRemoveReason(tile));
      snapshots.push(snapshotPlaced());

      reasons.push(canPlaceReason("Belt", tile));
      controller.clickLMB();
      reasons.push(canPlaceReason("Belt", tile));
      snapshots.push(snapshotPlaced());

      return { snapshots, reasons };
    };

    const first = runSequence();
    const second = runSequence();

    expect(first).toEqual(second);
    expect(first.snapshots).toHaveLength(6);
    expect(first.snapshots[0]).toBe("");
    expect(first.snapshots[1]).not.toBe("");
    expect(first.snapshots[1]).toBe(first.snapshots[2]);
    expect(first.snapshots[1]).toBe(first.snapshots[5]);
    expect(first.snapshots[3]).toBe("");
    expect(first.snapshots[4]).toBe("");

    expect(first.reasons).toHaveLength(8);
    expect(first.reasons[0]).toBe("ok");
    expect(first.reasons[1]).toBe("occupied");
    expect(first.reasons[2]).toBe("occupied");
    expect(first.reasons[3]).toBe("ok");
    expect(first.reasons[4]).toBe("non-removable-resource");
    expect(first.reasons[5]).toBe("non-removable-resource");
    expect(first.reasons[6]).toBe("ok");
    expect(first.reasons[7]).toBe("occupied");
  });

  it("rejects miner placement on non-resource tiles", () => {
    const width = 20;
    const height = 20;
    const { map, sim, snapshotPlaced, canPlaceReason } = createPlacementFixture(7331, width, height);
    const nonOreTile = firstTile(map, width, height, (x, y) => !map.isOre(x, y));
    const oreTile = firstTile(map, width, height, (x, y) => map.isOre(x, y));

    const controller = createPlacementController(sim);
    controller.selectKind("Miner");

    controller.setCursor(nonOreTile);
    expect(controller.getState().canPlace).toBe(false);
    expect(controller.getGhost().valid).toBe(false);
    expect(canPlaceReason("Miner", nonOreTile)).toBe("invalid-miner-on-resource");
    controller.clickLMB();
    expect(snapshotPlaced()).toBe("");

    controller.setCursor(oreTile);
    expect(controller.getState().canPlace).toBe(true);
    expect(controller.getGhost().valid).toBe(true);
  });

  it("prevents right-click from mutating unoccupied resource nodes", () => {
    const width = 20;
    const height = 20;
    const { map, sim, snapshotPlaced, canRemoveReason } = createPlacementFixture(42, width, height);
    const oreTile = firstTile(map, width, height, (x, y) => map.isOre(x, y));

    const controller = createPlacementController(sim);
    controller.setCursor(oreTile);
    controller.clickRMB();
    expect(canRemoveReason(oreTile)).toBe("non-removable-resource");

    expect(snapshotPlaced()).toBe("");
  });

  it("returns stable, non-throwing results for out-of-bounds placement and removal", () => {
    const width = 20;
    const height = 20;
    const { sim, snapshotPlaced, canPlaceReason, canRemoveReason } = createPlacementFixture(9001, width, height);

    const controller = createPlacementController(sim, { cols: width, rows: height });
    controller.selectKind("Miner");

    const outOfBoundsTile = { x: -1, y: 0 };
    const farOutsideTile = { x: width, y: height };
    const fractionalTile = { x: 0.5, y: 1.5 };

    expect(canPlaceReason("Miner", outOfBoundsTile)).toBe("out-of-bounds");
    expect(canPlaceReason("Miner", farOutsideTile)).toBe("out-of-bounds");
    expect(canPlaceReason("Miner", fractionalTile)).toBe("out-of-bounds");
    expect(canRemoveReason(outOfBoundsTile)).toBe("out-of-bounds");
    expect(canRemoveReason(farOutsideTile)).toBe("out-of-bounds");

    expect(() => controller.setCursor(outOfBoundsTile)).not.toThrow();
    expect(controller.getState().cursor).toBeNull();
    expect(() => {
      controller.clickLMB();
      controller.clickRMB();
    }).not.toThrow();
    expect(snapshotPlaced()).toBe("");

    expect(() => controller.setCursor(farOutsideTile)).not.toThrow();
    expect(controller.getState().cursor).toBeNull();
    expect(() => {
      controller.clickLMB();
      controller.clickRMB();
    }).not.toThrow();
    expect(snapshotPlaced()).toBe("");

    expect(() => controller.setCursor(fractionalTile)).not.toThrow();
    expect(() => {
      controller.clickLMB();
      controller.clickRMB();
    }).not.toThrow();
    expect(snapshotPlaced()).toBe("");
  });
});
