import { getDefinition } from "./registry";
import type {
  Direction,
  EntityBase,
  EntityKind,
  GridCoord,
  Sim,
} from "./types";

type CreateSimConfig = {
  width: number;
  height: number;
  seed: number | string;
};

type EntityInit = {
  pos: GridCoord;
  rot: Direction;
} & Record<string, unknown>;

const TICK_MS = 1000 / 60;
const STEP_EPSILON = 1e-7;

const toCellKey = (pos: GridCoord): string => `${pos.x},${pos.y}`;

const isOutOfBounds = (
  pos: GridCoord,
  width: number,
  height: number,
): boolean => {
  return pos.x < 0 || pos.y < 0 || pos.x >= width || pos.y >= height;
};

export const createSim = ({ width, height, seed }: CreateSimConfig): Sim => {
  void seed;

  const entitiesById = new Map<string, EntityBase>();
  const entitiesByCell = new Map<string, Set<string>>();
  const cellKeyById = new Map<string, string>();

  let nextEntityId = 1;
  let accumulatorMs = 0;

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

  const addEntity = (kind: EntityKind, init: EntityInit): string => {
    const definition = getDefinition(kind);
    if (definition === undefined) {
      throw new Error(`Unknown entity kind: ${String(kind)}`);
    }

    const id = String(nextEntityId);
    nextEntityId += 1;

    const createdState =
      typeof definition.create === "function"
        ? definition.create(init, sim)
        : undefined;

    const entity = {
      id,
      kind,
      pos: { ...init.pos },
      rot: init.rot,
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
    if (isOutOfBounds(pos, width, height)) {
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
  };

  const step = (dtMs: number): void => {
    if (!Number.isFinite(dtMs) || dtMs <= 0) {
      return;
    }

    accumulatorMs += dtMs;

    while (accumulatorMs + STEP_EPSILON >= TICK_MS) {
      runTick();
      accumulatorMs -= TICK_MS;
    }

    if (accumulatorMs < 0 && accumulatorMs > -STEP_EPSILON) {
      accumulatorMs = 0;
    }
  };

  const sim: Sim = {
    addEntity,
    removeEntity,
    getEntityById,
    getEntitiesAt,
    getAllEntities,
    step,
  };

  return sim;
};
