import type { TileType } from "./types";

type GridCoord = {
  x: number;
  y: number;
};

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

export type MapTransferFailureReason =
  | "out-of-bounds"
  | "self-transfer"
  | "empty-source"
  | "occupied-destination";

export type MapTransferRequest = {
  from: GridCoord;
  to: GridCoord;
};

export type MapTransferSuccessResult = {
  success: true;
  ok: true;
  kind: MapOccupantKind;
  from: GridCoord;
  to: GridCoord;
};

export type MapTransferFailureResult = {
  success: false;
  ok: false;
  reason: MapTransferFailureReason;
  from: GridCoord;
  to: GridCoord;
};

export type MapTransferResult = MapTransferSuccessResult | MapTransferFailureResult;

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
  transfer: (from: GridCoord, to: GridCoord) => MapTransferResult;
  transferMany: (transfers: ReadonlyArray<MapTransferRequest>) => MapTransferResult[];
}

type OrderedEntity = {
  id: string;
  pos: GridCoord;
};

const toStableEntityId = (id: string): number => {
  const maybeNumber = Number(id);
  return Number.isFinite(maybeNumber) && Number.isInteger(maybeNumber) ? maybeNumber : Number.MAX_SAFE_INTEGER;
};

type TransferCandidate = {
  index: number;
  from: GridCoord;
  to: GridCoord;
  fromKey: string;
  toKey: string;
};

const compareTransferSource = (left: TransferCandidate, right: TransferCandidate): number => {
  if (left.from.y !== right.from.y) {
    return left.from.y - right.from.y;
  }

  if (left.from.x !== right.from.x) {
    return left.from.x - right.from.x;
  }

  if (left.fromKey !== right.fromKey) {
    return left.fromKey < right.fromKey ? -1 : 1;
  }

  return left.index - right.index;
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
  const occupants = new Map<string, MapOccupantKind>();
  const lastIngressTickByTile = new Map<string, number>();
  let currentTransferTick = 0;
  let isTransferTickCommitScheduled = false;
  const random = createPrng(seed);
  const keyForTile = (x: number, y: number): string => `${x},${y}`;
  const tileCopy = (tile: GridCoord): GridCoord => ({ x: tile.x, y: tile.y });
  const isIntegerCoord = (value: number): value is number => Number.isInteger(value);

  const scheduleTransferTickCommit = (): void => {
    if (isTransferTickCommitScheduled) {
      return;
    }

    isTransferTickCommitScheduled = true;
    queueMicrotask(() => {
      currentTransferTick += 1;
      isTransferTickCommitScheduled = false;
    });
  };

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

  const makeTransferFailure = (
    reason: MapTransferFailureReason,
    from: GridCoord,
    to: GridCoord,
  ): MapTransferFailureResult => ({
    success: false,
    ok: false,
    reason,
    from: tileCopy(from),
    to: tileCopy(to),
  });

  const makeTransferSuccess = (kind: MapOccupantKind, from: GridCoord, to: GridCoord): MapTransferSuccessResult => ({
    success: true,
    ok: true,
    kind,
    from: tileCopy(from),
    to: tileCopy(to),
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

  const transferMany = (transfers: ReadonlyArray<MapTransferRequest>): MapTransferResult[] => {
    const outcomes: MapTransferResult[] = new Array(transfers.length);

    const candidates: TransferCandidate[] = [];
    const usedSources = new Set<string>();
    const requestsByDestination = new Map<string, TransferCandidate[]>();
    const provisionalWinners = new Map<number, TransferCandidate>();

    for (let index = 0; index < transfers.length; index += 1) {
      const transfer = transfers[index];
      if (transfer === undefined) {
        continue;
      }

      if (!isPlaceableCoord(transfer.from.x, transfer.from.y) || !isPlaceableCoord(transfer.to.x, transfer.to.y)) {
        outcomes[index] = makeTransferFailure("out-of-bounds", transfer.from, transfer.to);
        continue;
      }

      if (transfer.from.x === transfer.to.x && transfer.from.y === transfer.to.y) {
        outcomes[index] = makeTransferFailure("self-transfer", transfer.from, transfer.to);
        continue;
      }

      const fromKey = keyForTile(transfer.from.x, transfer.from.y);
      const toKey = keyForTile(transfer.to.x, transfer.to.y);
      if (occupantAt(transfer.from) === undefined) {
        outcomes[index] = makeTransferFailure("empty-source", transfer.from, transfer.to);
        continue;
      }

      const candidate: TransferCandidate = {
        index,
        from: tileCopy(transfer.from),
        to: tileCopy(transfer.to),
        fromKey,
        toKey,
      };

      candidates.push(candidate);

      let bucket = requestsByDestination.get(toKey);
      if (bucket === undefined) {
        bucket = [];
        requestsByDestination.set(toKey, bucket);
      }

      bucket.push(candidate);
    }

    const isSameTickIngressFor = (key: string, tick: number): boolean => lastIngressTickByTile.get(key) === tick;

    for (const [destinationKey, contenders] of requestsByDestination) {
      contenders.sort(compareTransferSource);

      const winner = contenders.find((candidate) => {
        if (usedSources.has(candidate.fromKey)) {
          return false;
        }

        if (occupantAt(candidate.to) !== undefined) {
          return false;
        }

        return true;
      });

      if (winner === undefined) {
        for (const contender of contenders) {
          if (outcomes[contender.index] !== undefined) {
            continue;
          }

          outcomes[contender.index] = makeTransferFailure(
            "occupied-destination",
            contender.from,
            contender.to,
          );
        }
        continue;
      }

      usedSources.add(winner.fromKey);
      provisionalWinners.set(winner.index, winner);

      for (const contender of contenders) {
        if (outcomes[contender.index] !== undefined) {
          continue;
        }

        if (contender.index === winner.index) {
          continue;
        }

        outcomes[contender.index] = makeTransferFailure(
          "occupied-destination",
          contender.from,
          contender.to,
        );
      }
    }

    const activeWinnerIndexes = new Set<number>(provisionalWinners.keys());

    while (true) {
      const destinationsThisTick = new Set<string>();
      for (const winnerIndex of activeWinnerIndexes) {
        const winner = provisionalWinners.get(winnerIndex);
        if (winner === undefined) {
          continue;
        }

        destinationsThisTick.add(winner.toKey);
      }

      const blockedWinners: number[] = [];
      for (const winnerIndex of activeWinnerIndexes) {
        const winner = provisionalWinners.get(winnerIndex);
        if (winner === undefined) {
          continue;
        }

        if (destinationsThisTick.has(winner.fromKey) || isSameTickIngressFor(winner.fromKey, currentTransferTick)) {
          blockedWinners.push(winnerIndex);
          outcomes[winnerIndex] = makeTransferFailure("occupied-destination", winner.from, winner.to);
        }
      }

      if (blockedWinners.length === 0) {
        break;
      }

      for (const winnerIndex of blockedWinners) {
        activeWinnerIndexes.delete(winnerIndex);
      }
    }

    for (const candidate of candidates) {
      if (!activeWinnerIndexes.has(candidate.index)) {
        continue;
      }

      if (outcomes[candidate.index] !== undefined) {
        continue;
      }

      if (isSameTickIngressFor(candidate.fromKey, currentTransferTick)) {
        outcomes[candidate.index] = makeTransferFailure("occupied-destination", candidate.from, candidate.to);
        activeWinnerIndexes.delete(candidate.index);
        continue;
      }

      const kind = occupantAt(candidate.from);
      if (kind === undefined) {
        outcomes[candidate.index] = makeTransferFailure("empty-source", candidate.from, candidate.to);
        continue;
      }

      if (occupantAt(candidate.to) !== undefined) {
        outcomes[candidate.index] = makeTransferFailure("occupied-destination", candidate.from, candidate.to);
        continue;
      }

      if (occupantAt(candidate.to) !== undefined) {
        outcomes[candidate.index] = makeTransferFailure("occupied-destination", candidate.from, candidate.to);
        continue;
      }

      occupants.delete(candidate.fromKey);
      occupants.set(candidate.toKey, kind);
      lastIngressTickByTile.set(candidate.toKey, currentTransferTick);
      outcomes[candidate.index] = makeTransferSuccess(kind, candidate.from, candidate.to);
    }

    scheduleTransferTickCommit();

    return outcomes;
  };

  const transfer = (from: GridCoord, to: GridCoord): MapTransferResult => {
    return transferMany([{ from, to }])[0] ?? {
      success: false,
      ok: false,
      reason: "out-of-bounds",
      from: tileCopy(from),
      to: tileCopy(to),
    };
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
    transfer,
    transferMany,
  };
}
