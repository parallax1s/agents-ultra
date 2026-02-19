import assert from "node:assert/strict";
import { test } from "node:test";

import { createMap } from "../src/core/map.ts";

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

test("createMap is deterministic for the same seed", () => {
  const first = snapshotTiles(64, 64, 1337);
  const second = snapshotTiles(64, 64, 1337);

  assert.equal(first, second);
});

test("createMap differs when using different seeds", () => {
  const first = snapshotTiles(64, 64, 1337);
  const second = snapshotTiles(64, 64, 7331);

  assert.notEqual(first, second);
});

test("center spawn area remains ore-free (at least 10x10)", () => {
  const width = 60;
  const height = 40;
  const map = createMap(width, height, 99);

  const spawnWidth = 10;
  const spawnHeight = 10;
  const startX = Math.floor((width - spawnWidth) / 2);
  const startY = Math.floor((height - spawnHeight) / 2);

  for (let y = startY; y < startY + spawnHeight; y += 1) {
    for (let x = startX; x < startX + spawnWidth; x += 1) {
      assert.equal(map.isOre(x, y), false);
      assert.equal(map.getTile(x, y), "empty");
    }
  }
});

test("getTile and isOre handle bounds safely", () => {
  const map = createMap(20, 20, 123);

  assert.equal(map.getTile(-1, 0), undefined);
  assert.equal(map.getTile(0, -1), undefined);
  assert.equal(map.getTile(20, 0), undefined);
  assert.equal(map.getTile(0, 20), undefined);
  assert.equal(map.getTile(0.5, 1), undefined);
  assert.equal(map.getTile(1, 0.5), undefined);

  assert.equal(map.isOre(-1, 0), false);
  assert.equal(map.isOre(0, -1), false);
  assert.equal(map.isOre(20, 0), false);
  assert.equal(map.isOre(0, 20), false);
  assert.equal(map.isOre(0.5, 1), false);
  assert.equal(map.isOre(1, 0.5), false);
});
