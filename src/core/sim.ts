import { getDefinition } from "./registry";
import type {
  Direction,
  EntityBase,
  EntityKind,
  GridCoord,
} from "./types";

type CreateSimConfig = {
  width?: number;
  height?: number;
  seed?: number | string;
};

type EntityInit = {
  pos: GridCoord;
  rot?: Direction;
} & Record<string, unknown>;

type EntityDescriptor = {
  kind: EntityKind | (string & {});
} & EntityInit;

const TICK_MS = 1000 / 60;
const STEP_EPSILON = 1e-7;
const DEFAULT_ROTATION: Direction = "N";
const DEFAULT_WORLD_WIDTH = 64;
const DEFAULT_WORLD_HEIGHT = 64;
const DEFAULT_WORLD_SEED = 0;

const toCellKey = (pos: GridCoord): string => `${pos.x},${pos.y}`;

const isOutOfBounds = (
  pos: GridCoord,
  width: number,
  height: number,
): boolean => {
  return pos.x < 0 || pos.y < 0 || pos.x >= width || pos.y >= height;
};

const isGridCoord = (value: unknown): value is GridCoord => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { x?: unknown; y?: unknown };
  return (
    typeof candidate.x === "number" &&
    Number.isInteger(candidate.x) &&
    typeof candidate.y === "number" &&
    Number.isInteger(candidate.y)
  );
};

const isDirection = (value: unknown): value is Direction =>
  value === "N" || value === "E" || value === "S" || value === "W";

const toEntityDescriptor = (
  descriptorOrKind: EntityDescriptor | EntityKind | (string & {}),
  init: EntityInit | undefined,
): { kind: EntityKind | (string & {}); init: EntityInit } => {
  if (typeof descriptorOrKind === "string") {
    if (init === undefined) {
      throw new Error("addEntity(kind, init) requires an init object");
    }
    return { kind: descriptorOrKind, init };
  }

  if (typeof descriptorOrKind !== "object" || descriptorOrKind === null) {
    throw new Error("addEntity requires either a kind string or descriptor object");
  }

  const { kind, ...rest } = descriptorOrKind;
  return { kind, init: rest };
};

export const createSim = ({ width, height, seed }: CreateSimConfig = {}) => {
  const worldWidth = width ?? DEFAULT_WORLD_WIDTH;
  const worldHeight = height ?? DEFAULT_WORLD_HEIGHT;
  const worldSeed = seed ?? DEFAULT_WORLD_SEED;

  if (!Number.isInteger(worldWidth) || worldWidth <= 0) {
    throw new RangeError("width must be a positive integer");
  }
  if (!Number.isInteger(worldHeight) || worldHeight <= 0) {
    throw new RangeError("height must be a positive integer");
  }

  void worldSeed;

  const entitiesById = new Map<string, EntityBase>();
  const entitiesByCell = new Map<string, Set<string>>();
  const cellKeyById = new Map<string, string>();

  let nextEntityId = 1;
  let accumulatorMs = 0;
  let paused = false;
  let tick = 0;
  let tickCount = 0;
  let elapsedMs = 0;

  const removeFromIndexedCell = (id: string): void => {
    const previousKey = cellKeyById.get(id);
    if (previousKey === undefined) {
      return;
    }

    cellKeyById.delete(id);
    const cellIds = entitiesByCell.get(previousKey);
    if (cellIds === undefined) {
      return;
    }

    cellIds.delete(id);
    if (cellIds.size === 0) {
      entitiesByCell.delete(previousKey);
    }
  };

  const indexInCell = (id: string, pos: GridCoord): void => {
    const nextKey = toCellKey(pos);
    const previousKey = cellKeyById.get(id);

    if (previousKey === nextKey) {
      return;
    }

    if (previousKey !== undefined) {
      const previousCellIds = entitiesByCell.get(previousKey);
      if (previousCellIds !== undefined) {
        previousCellIds.delete(id);
        if (previousCellIds.size === 0) {
          entitiesByCell.delete(previousKey);
        }
      }
    }

    let cellIds = entitiesByCell.get(nextKey);
    if (cellIds === undefined) {
      cellIds = new Set<string>();
      entitiesByCell.set(nextKey, cellIds);
    }

    cellIds.add(id);
    cellKeyById.set(id, nextKey);
  };

  const addEntity = (
    descriptorOrKind: EntityDescriptor | EntityKind | (string & {}),
    initArg?: EntityInit,
  ): string => {
    const { kind, init } = toEntityDescriptor(descriptorOrKind, initArg);
    if (!isGridCoord(init.pos)) {
      throw new Error("addEntity init.pos must be an integer GridCoord");
    }
    const rot = isDirection(init.rot) ? init.rot : DEFAULT_ROTATION;
    const definition = getDefinition(kind);
    if (definition === undefined) {
      throw new Error(`Unknown entity kind: ${String(kind)}`);
    }

    if (isOutOfBounds(init.pos, worldWidth, worldHeight)) {
      throw new RangeError(`Entity position ${init.pos.x},${init.pos.y} is out of bounds`);
    }

    const id = String(nextEntityId);
    nextEntityId += 1;

    const createdState =
      typeof definition.create === "function"
        ? definition.create({ ...init, rot }, sim)
        : undefined;

    const entity = {
      id,
      kind,
      pos: { ...init.pos },
      rot,
      ...(createdState === undefined ? {} : { state: createdState }),
    } as EntityBase;

    entitiesById.set(id, entity);
    indexInCell(id, entity.pos);

    return id;
  };

  const removeEntity = (id: string): boolean => {
    const existed = entitiesById.delete(id);
    if (!existed) {
      return false;
    }

    removeFromIndexedCell(id);
    return true;
  };

  const getEntityById = (id: string): EntityBase | undefined => {
    return entitiesById.get(id);
  };

  const getEntitiesAt = (pos: GridCoord): EntityBase[] => {
    if (isOutOfBounds(pos, worldWidth, worldHeight)) {
      return [];
    }

    const cellIds = entitiesByCell.get(toCellKey(pos));
    if (cellIds === undefined) {
      return [];
    }

    const entities: EntityBase[] = [];
    for (const id of cellIds) {
      const entity = entitiesById.get(id);
      if (entity !== undefined) {
        entities.push(entity);
      }
    }

    return entities;
  };

  const getAllEntities = (): EntityBase[] => {
    return Array.from(entitiesById.values());
  };

  const runTick = (): void => {
    const ids = Array.from(entitiesById.keys());

    for (const id of ids) {
      const entity = entitiesById.get(id);
      if (entity === undefined) {
        continue;
      }

      const definition = getDefinition(entity.kind);
      if (definition === undefined) {
        throw new Error(`Unknown entity kind: ${String(entity.kind)}`);
      }

      if (typeof definition.update !== "function") {
        continue;
      }

      const previousPos = { x: entity.pos.x, y: entity.pos.y };
      definition.update(entity, TICK_MS, sim);

      if (
        entitiesById.has(id) &&
        (previousPos.x !== entity.pos.x || previousPos.y !== entity.pos.y)
      ) {
        indexInCell(id, entity.pos);
      }
    }

    tick += 1;
    tickCount += 1;
    elapsedMs += TICK_MS;
  };

  const step = (dtMs: number): void => {
    if (paused) {
      return;
    }

    if (!Number.isFinite(dtMs) || dtMs <= 0) {
      return;
    }

    accumulatorMs += dtMs;
    const stepsToRun = Math.floor((accumulatorMs + STEP_EPSILON) / TICK_MS);
    if (stepsToRun <= 0) {
      return;
    }

    accumulatorMs -= stepsToRun * TICK_MS;

    for (let stepIndex = 0; stepIndex < stepsToRun; stepIndex += 1) {
      runTick();
    }

    if (accumulatorMs < 0 && accumulatorMs > -STEP_EPSILON) {
      accumulatorMs = 0;
    }
  };

  const sim = {
    width: worldWidth,
    height: worldHeight,
    pause(): void {
      paused = true;
    },
    resume(): void {
      paused = false;
    },
    togglePause(): void {
      paused = !paused;
    },
    addEntity,
    removeEntity,
    getEntityById,
    getEntitiesAt,
    getAllEntities,
    get paused(): boolean {
      return paused;
    },
    get tick(): number {
      return tick;
    },
    get tickCount(): number {
      return tickCount;
    },
    get elapsedMs(): number {
      return elapsedMs;
    },
    step,
  };

  return sim;
};

export type Sim = ReturnType<typeof createSim>;
