import { describe, expect, it } from "vitest";

import { createMap } from "../src/core/map";

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
});
