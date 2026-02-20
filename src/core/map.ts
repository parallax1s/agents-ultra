import type { GridCoord, TileType } from "./types";

export type MapOccupantKind = "miner" | "belt" | "inserter" | "furnace";

export type MapPlacementFailureReason = "occupied" | "out-of-bounds" | "invalid-miner-on-resource";

export type MapRemovalFailureReason = "out-of-bounds" | "empty" | "non-removable-resource";

export type MapPlacementSuccessResult = {
  success: true;
  ok: true;
  kind: MapOccupantKind;
  tile: GridCoord;
};

export type MapPlacementFailureResult = {
  success: false;
  ok: false;
  reason: MapPlacementFailureReason;
  tile: GridCoord;
};

export type MapPlacementResult = MapPlacementSuccessResult | MapPlacementFailureResult;

export type MapRemovalSuccessResult = {
  success: true;
  ok: true;
  removedKind: MapOccupantKind;
  tile: GridCoord;
};

export type MapRemovalFailureResult = {
  success: false;
  ok: false;
  reason: MapRemovalFailureReason;
  tile: GridCoord;
};

export type MapRemovalResult = MapRemovalSuccessResult | MapRemovalFailureResult;

export interface GeneratedMap {
  width: number;
  height: number;
  getTile: (x: number, y: number) => TileType | undefined;
  isOre: (x: number, y: number) => boolean;
  isWithinBounds: (x: number, y: number) => boolean;
  hasEntityAt: (tile: GridCoord) => boolean;
  place: (kind: MapOccupantKind, tile: GridCoord) => MapPlacementResult;
  placeEntity: (kind: MapOccupantKind, tile: GridCoord) => MapPlacementResult;
  remove: (tile: GridCoord) => MapRemovalResult;
  removeEntity: (tile: GridCoord) => MapRemovalResult;
}

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
  const occupants = new Map<string, MapOccupantKind>();
  const random = createPrng(seed);
  const keyForTile = (x: number, y: number): string => `${x},${y}`;
  const tileCopy = (tile: GridCoord): GridCoord => ({ x: tile.x, y: tile.y });
  const isIntegerCoord = (value: number): value is number => Number.isInteger(value);

  const isPlaceableCoord = (x: number, y: number): boolean => isIntegerCoord(x) && isIntegerCoord(y) && isWithinBounds(x, y);
  const occupantAt = (tile: GridCoord): MapOccupantKind | undefined => occupants.get(keyForTile(tile.x, tile.y));

  const makePlacementFailure = (reason: MapPlacementFailureReason, tile: GridCoord): MapPlacementFailureResult => {
    return {
      success: false,
      ok: false,
      reason,
      tile: tileCopy(tile),
    };
  };

  const makeRemovalFailure = (reason: MapRemovalFailureReason, tile: GridCoord): MapRemovalFailureResult => {
    return {
      success: false,
      ok: false,
      reason,
      tile: tileCopy(tile),
    };
  };

  const makePlacementSuccess = (kind: MapOccupantKind, tile: GridCoord): MapPlacementSuccessResult => ({
    success: true,
    ok: true,
    kind,
    tile: tileCopy(tile),
  });

  const makeRemovalSuccess = (removedKind: MapOccupantKind, tile: GridCoord): MapRemovalSuccessResult => ({
    success: true,
    ok: true,
    removedKind,
    tile: tileCopy(tile),
  });

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

  const hasEntityAt = (tile: GridCoord): boolean => {
    if (!isPlaceableCoord(tile.x, tile.y)) {
      return false;
    }

    return occupantAt(tile) !== undefined;
  };

  const place = (kind: MapOccupantKind, tile: GridCoord): MapPlacementResult => {
    if (!isPlaceableCoord(tile.x, tile.y)) {
      return makePlacementFailure("out-of-bounds", tile);
    }

    if (hasEntityAt(tile)) {
      return makePlacementFailure("occupied", tile);
    }

    if (kind === "miner" && !isOre(tile.x, tile.y)) {
      return makePlacementFailure("invalid-miner-on-resource", tile);
    }

    occupants.set(keyForTile(tile.x, tile.y), kind);
    return makePlacementSuccess(kind, tile);
  };

  const remove = (tile: GridCoord): MapRemovalResult => {
    if (!isPlaceableCoord(tile.x, tile.y)) {
      return makeRemovalFailure("out-of-bounds", tile);
    }

    const key = keyForTile(tile.x, tile.y);
    const removedKind = occupants.get(key);
    if (removedKind === undefined) {
      if (isOre(tile.x, tile.y)) {
        return makeRemovalFailure("non-removable-resource", tile);
      }

      return makeRemovalFailure("empty", tile);
    }

    occupants.delete(key);
    return makeRemovalSuccess(removedKind, tile);
  };

  return {
    width,
    height,
    getTile,
    isOre,
    isWithinBounds,
    hasEntityAt,
    place,
    placeEntity: place,
    remove,
    removeEntity: remove,
  };
}
