import type { TileType } from "./types";

import type { GridCoord } from "./types";

export interface GeneratedMap {
  width: number;
  height: number;
  getTile: (x: number, y: number) => TileType | undefined;
  isOre: (x: number, y: number) => boolean;
  isWithinBounds: (x: number, y: number) => boolean;
}

type OrderedEntity = {
  id: string;
  pos: GridCoord;
};

const toStableEntityId = (id: string): number => {
  const maybeNumber = Number(id);
  return Number.isFinite(maybeNumber) && Number.isInteger(maybeNumber) ? maybeNumber : Number.MAX_SAFE_INTEGER;
};

const compareId = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }

  const leftValue = toStableEntityId(left);
  const rightValue = toStableEntityId(right);

  if (leftValue !== rightValue) {
    return leftValue - rightValue;
  }

  return left < right ? -1 : 1;
};

export const compareGridEntityOrder = (left: OrderedEntity, right: OrderedEntity): number => {
  if (left.pos.y !== right.pos.y) {
    return left.pos.y - right.pos.y;
  }

  if (left.pos.x !== right.pos.x) {
    return left.pos.x - right.pos.x;
  }

  return compareId(left.id, right.id);
};

export const sortByGridEntityOrder = <T extends OrderedEntity>(entities: ReadonlyArray<T>): T[] => {
  return [...entities].sort(compareGridEntityOrder);
};

const MIN_SPAWN_SIZE = 10;

function seedToUint32(seed: number | string): number {
  if (typeof seed === "number" && Number.isFinite(seed)) {
    return (Math.floor(seed) >>> 0) || 0x9e3779b9;
  }

  const text = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0 || 0x9e3779b9;
}

function createPrng(seed: number | string): () => number {
  let state = seedToUint32(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function createMap(width: number, height: number, seed: number | string): GeneratedMap {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError("width and height must be positive integers");
  }

  const oreMask = new Uint8Array(width * height);
  const random = createPrng(seed);

  const spawnWidth = Math.min(MIN_SPAWN_SIZE, width);
  const spawnHeight = Math.min(MIN_SPAWN_SIZE, height);
  const spawnStartX = Math.floor((width - spawnWidth) / 2);
  const spawnStartY = Math.floor((height - spawnHeight) / 2);
  const spawnEndX = spawnStartX + spawnWidth - 1;
  const spawnEndY = spawnStartY + spawnHeight - 1;

  const isWithinBounds = (x: number, y: number): boolean =>
    Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;

  const isSpawnTile = (x: number, y: number): boolean =>
    x >= spawnStartX && x <= spawnEndX && y >= spawnStartY && y <= spawnEndY;

  const writeOre = (x: number, y: number): void => {
    if (!isWithinBounds(x, y) || isSpawnTile(x, y)) {
      return;
    }

    oreMask[y * width + x] = 1;
  };

  const availableTiles = width * height - spawnWidth * spawnHeight;
  if (availableTiles > 0) {
    const patchCount = Math.max(1, Math.floor((width * height) / 225));
    let oreTileCount = 0;

    for (let patchIndex = 0; patchIndex < patchCount; patchIndex += 1) {
      let centerX = 0;
      let centerY = 0;
      let hasCenter = false;

      for (let attempt = 0; attempt < 40; attempt += 1) {
        const candidateX = Math.floor(random() * width);
        const candidateY = Math.floor(random() * height);
        if (!isSpawnTile(candidateX, candidateY)) {
          centerX = candidateX;
          centerY = candidateY;
          hasCenter = true;
          break;
        }
      }

      if (!hasCenter) {
        continue;
      }

      const radiusX = 2 + Math.floor(random() * 5);
      const radiusY = 2 + Math.floor(random() * 5);

      for (let y = centerY - radiusY; y <= centerY + radiusY; y += 1) {
        for (let x = centerX - radiusX; x <= centerX + radiusX; x += 1) {
          if (!isWithinBounds(x, y) || isSpawnTile(x, y)) {
            continue;
          }

          const normX = (x - centerX) / radiusX;
          const normY = (y - centerY) / radiusY;
          const distance = normX * normX + normY * normY;
          const shapeNoise = 0.82 + random() * 0.32;
          const densityNoise = random();
          if (distance <= shapeNoise && densityNoise >= distance * 0.18) {
            const idx = y * width + x;
            if (oreMask[idx] === 0) {
              oreTileCount += 1;
            }
            oreMask[idx] = 1;
          }
        }
      }
    }

    // Keep at least one patch tile for very small maps where noise rejects all candidates.
    if (oreTileCount === 0) {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const x = Math.floor(random() * width);
        const y = Math.floor(random() * height);
        if (!isSpawnTile(x, y)) {
          writeOre(x, y);
          break;
        }
      }
    }
  }

  const isOre = (x: number, y: number): boolean => {
    if (!isWithinBounds(x, y)) {
      return false;
    }

    return oreMask[y * width + x] === 1;
  };

  const getTile = (x: number, y: number): TileType | undefined => {
    if (!isWithinBounds(x, y)) {
      return undefined;
    }

    return isOre(x, y) ? "iron-ore" : "empty";
  };

  return {
    width,
    height,
    getTile,
    isOre,
    isWithinBounds,
  };
}
