import {
  getCanonicalKindRank,
  getDefinition,
  SIM_TICK_CADENCE_MS,
} from "./registry";
import type { GeneratedMap } from "./map";
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
  map?: GeneratedMap;
};

type EntityInit = {
  pos: GridCoord;
  rot?: Direction;
} & Record<string, unknown>;

type EntityDescriptor = {
  kind: EntityKind | (string & {});
} & EntityInit;

const getCanonicalTickRank = getCanonicalKindRank;
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

export const createSim = ({ width, height, seed, map }: CreateSimConfig = {}) => {
  const worldWidth = width ?? DEFAULT_WORLD_WIDTH;
  const worldHeight = height ?? DEFAULT_WORLD_HEIGHT;
  const worldSeed = seed ?? DEFAULT_WORLD_SEED;
  const worldMap = map;

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
  const publicEntitiesById = new Map<string, EntityBase>();
  const publicEntitiesByCell = new Map<string, Set<string>>();
  const publicCellKeyById = new Map<string, string>();

  let nextEntityId = 1;
  let nextEntityInsertionOrder = 0;
  let accumulatorMs = 0;
  let paused = false;
  let tick = 0;
  let tickCount = 0;
  let elapsedMs = 0;
  let runningStep = false;
  const insertionOrderById = new Map<string, number>();

  type CellIndex = {
    readonly entitiesByCell: Map<string, Set<string>>;
    readonly cellKeyById: Map<string, string>;
  };

  const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (typeof value !== "object" || value === null) {
      return false;
    }

    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  };

  const cloneSnapshotValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry) => cloneSnapshotValue(entry));
    }

    if (!isPlainObject(value)) {
      return value;
    }

    const clone: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      clone[key] = cloneSnapshotValue((value as Record<string, unknown>)[key]);
    }

    return clone;
  };

  const cloneEntityForPublic = (entity: EntityBase): EntityBase => {
    return {
      id: entity.id,
      kind: entity.kind,
      pos: { x: entity.pos.x, y: entity.pos.y },
      rot: entity.rot,
      state: cloneSnapshotValue(entity.state),
    };
  };

  const createTickStartStateView = (
    state: Record<string, unknown>,
  ): Record<string, unknown> => {
    const snapshotState = cloneSnapshotValue(state);
    if (!isPlainObject(snapshotState)) {
      return state;
    }

    const stateSnapshot = snapshotState;
    return new Proxy(state, {
      get(target, property, receiver): unknown {
        if (typeof property === "string" && Object.prototype.hasOwnProperty.call(stateSnapshot, property)) {
          return stateSnapshot[property];
        }
        return Reflect.get(target, property, receiver);
      },
      has(target, property): boolean {
        if (typeof property === "string" && Object.prototype.hasOwnProperty.call(stateSnapshot, property)) {
          return true;
        }
        return Reflect.has(target, property);
      },
      set(target, property, value, receiver): boolean {
        if (typeof property === "string" && Object.prototype.hasOwnProperty.call(stateSnapshot, property)) {
          stateSnapshot[property] = value;
        }
        return Reflect.set(target, property, value, receiver);
      },
    });
  };

  const createTickStartEntitySnapshot = (entity: EntityBase): EntityBase => {
    const snapshot = cloneEntityForPublic(entity);
    if (!isPlainObject(entity.state)) {
      return snapshot;
    }

    snapshot.state = createTickStartStateView(entity.state as Record<string, unknown>);
    return snapshot;
  };

  const removeFromIndexedCell = (id: string, index: CellIndex): void => {
    const previousKey = index.cellKeyById.get(id);
    if (previousKey === undefined) {
      return;
    }

    index.cellKeyById.delete(id);
    const cellIds = index.entitiesByCell.get(previousKey);
    if (cellIds === undefined) {
      return;
    }

    cellIds.delete(id);
    if (cellIds.size === 0) {
      index.entitiesByCell.delete(previousKey);
    }
  };

  const indexInCell = (id: string, pos: GridCoord, index: CellIndex): void => {
    const nextKey = toCellKey(pos);
    const previousKey = index.cellKeyById.get(id);

    if (previousKey === nextKey) {
      return;
    }

    if (previousKey !== undefined) {
      const previousCellIds = index.entitiesByCell.get(previousKey);
      if (previousCellIds !== undefined) {
        previousCellIds.delete(id);
        if (previousCellIds.size === 0) {
          index.entitiesByCell.delete(previousKey);
        }
      }
    }

    let cellIds = index.entitiesByCell.get(nextKey);
    if (cellIds === undefined) {
      cellIds = new Set<string>();
      index.entitiesByCell.set(nextKey, cellIds);
    }

    cellIds.add(id);
    index.cellKeyById.set(id, nextKey);
  };

  const getInternalEntityById = (id: string): EntityBase | undefined => {
    return entitiesById.get(id);
  };

  const getInternalEntitiesAt = (pos: GridCoord): EntityBase[] => {
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

  const getInternalAllEntities = (): EntityBase[] => {
    return Array.from(entitiesById.values());
  };

  const publishPublicState = (): void => {
    publicEntitiesById.clear();
    publicEntitiesByCell.clear();
    publicCellKeyById.clear();

    for (const entity of entitiesById.values()) {
      const publicEntity = cloneEntityForPublic(entity);
      publicEntitiesById.set(publicEntity.id, publicEntity);
      indexInCell(publicEntity.id, publicEntity.pos, {
        entitiesByCell: publicEntitiesByCell,
        cellKeyById: publicCellKeyById,
      });
    }
  };

  const publishAfterMutation = (): void => {
    if (!runningStep) {
      publishPublicState();
    }
  };

  const getEntityById = (id: string): EntityBase | undefined => {
    return getInternalEntityById(id);
  };

  const getEntitiesAt = (pos: GridCoord): EntityBase[] => {
    if (isOutOfBounds(pos, worldWidth, worldHeight)) {
      return [];
    }

    const cellIds = publicEntitiesByCell.get(toCellKey(pos));
    if (cellIds === undefined) {
      return [];
    }

    const entities: EntityBase[] = [];
    for (const id of cellIds) {
      const entity = publicEntitiesById.get(id);
      if (entity !== undefined) {
        entities.push(entity);
      }
    }

    return entities;
  };

  const getAllEntities = (): EntityBase[] => {
    return Array.from(publicEntitiesById.values());
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
    insertionOrderById.set(id, nextEntityInsertionOrder);
    nextEntityInsertionOrder += 1;

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
    indexInCell(id, entity.pos, {
      entitiesByCell,
      cellKeyById,
    });
    publishAfterMutation();

    return id;
  };

  const removeEntity = (id: string): boolean => {
    const existed = entitiesById.delete(id);
    if (!existed) {
      return false;
    }

    removeFromIndexedCell(id, {
      entitiesByCell,
      cellKeyById,
    });
    publishAfterMutation();
    return true;
  };

  const runTick = (): void => {
    runningStep = true;
    try {
      const tickStartEntitySnapshotById = new Map<string, EntityBase>();
      const tickStartEntityIdsByCell = new Map<string, Set<string>>();

      for (const [id, entity] of entitiesById) {
        tickStartEntitySnapshotById.set(id, createTickStartEntitySnapshot(entity));
        const key = toCellKey(entity.pos);
        const idsAtCell = tickStartEntityIdsByCell.get(key);
        if (idsAtCell === undefined) {
          tickStartEntityIdsByCell.set(key, new Set([id]));
          continue;
        }
        idsAtCell.add(id);
      }

      const ids = Array.from(entitiesById.keys()).sort((leftId, rightId) => {
        const leftEntity = entitiesById.get(leftId);
        const rightEntity = entitiesById.get(rightId);
        if (leftEntity === undefined || rightEntity === undefined) {
          return 0;
        }

        const phaseRankDiff =
          getCanonicalTickRank(leftEntity.kind) - getCanonicalTickRank(rightEntity.kind);
        if (phaseRankDiff !== 0) {
          return phaseRankDiff;
        }

        const leftOrder = insertionOrderById.get(leftId);
        const rightOrder = insertionOrderById.get(rightId);
        if (leftOrder === rightOrder) {
          return 0;
        }

        if (leftOrder === undefined) {
          return 1;
        }

        if (rightOrder === undefined) {
          return -1;
        }

        return leftOrder - rightOrder;
      });

      const getTickStartEntitiesAt = (pos: GridCoord): EntityBase[] => {
        if (isOutOfBounds(pos, worldWidth, worldHeight)) {
          return [];
        }

        const idsAtCell = tickStartEntityIdsByCell.get(toCellKey(pos));
        if (idsAtCell === undefined) {
          return [];
        }

        const entities: EntityBase[] = [];
        for (const id of idsAtCell) {
          const entity = tickStartEntitySnapshotById.get(id);
          if (entity !== undefined) {
            entities.push(entity);
          }
        }

        return entities;
      };

      const getTickStartEntities = (): EntityBase[] => {
        return Array.from(tickStartEntitySnapshotById.values());
      };

      const getTickStartEntityById = (id: string): EntityBase | undefined => {
        return tickStartEntitySnapshotById.get(id);
      };

      const updateContext = {
        width: worldWidth,
        height: worldHeight,
        tick,
        tickCount,
        map: worldMap,
        getMap: (): GeneratedMap | undefined => worldMap,
        getEntitiesAt: getTickStartEntitiesAt,
        getEntityById: getTickStartEntityById,
        getAllEntities: getTickStartEntities,
        getLiveEntitiesAt: getInternalEntitiesAt,
        getLiveEntityById: getInternalEntityById,
        getLiveAllEntities: getInternalAllEntities,
      };

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
        definition.update(entity, SIM_TICK_CADENCE_MS, updateContext);

        if (
          entitiesById.has(id) &&
          (previousPos.x !== entity.pos.x || previousPos.y !== entity.pos.y)
        ) {
          indexInCell(id, entity.pos, {
            entitiesByCell,
            cellKeyById,
          });
        }
      }

      tick += 1;
      tickCount += 1;
      elapsedMs += SIM_TICK_CADENCE_MS;
      publishPublicState();
    } finally {
      runningStep = false;
    }
  };

  const step = (dtMs: number): void => {
    if (paused) {
      return;
    }

    if (!Number.isFinite(dtMs) || dtMs <= 0) {
      return;
    }

    accumulatorMs += dtMs;
    const stepsToRun = Math.floor((accumulatorMs + STEP_EPSILON) / SIM_TICK_CADENCE_MS);
    if (stepsToRun <= 0) {
      return;
    }

    accumulatorMs -= stepsToRun * SIM_TICK_CADENCE_MS;

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
    map: worldMap,
    getMap(): GeneratedMap | undefined {
      return worldMap;
    },
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
    isPaused(): boolean {
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
