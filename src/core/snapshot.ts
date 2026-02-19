import type { Direction, EntityBase, EntityKind, GridCoord } from "./types";

export type SnapshotGrid = {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
};

export type SnapshotTiming = {
  readonly tick: number;
  readonly elapsedMs: number;
  readonly tickCount: number;
};

export type SnapshotOreCell = {
  readonly x: number;
  readonly y: number;
};

export type SnapshotEntity = {
  readonly id: string;
  readonly kind: EntityKind;
  readonly pos: GridCoord;
  readonly rot: Direction;
  readonly light?: unknown;
};

export type Snapshot = Readonly<{
  readonly grid: SnapshotGrid;
  readonly time: SnapshotTiming;
  readonly ore: ReadonlyArray<Readonly<SnapshotOreCell>>;
  readonly entities: ReadonlyArray<SnapshotEntity>;
}>;

type SnapshotMap = {
  readonly width: number;
  readonly height: number;
  readonly isOre: (x: number, y: number) => boolean;
};

type SnapshotSim = {
  readonly getAllEntities?: () => EntityBase[];
  readonly width?: number;
  readonly height?: number;
  readonly tileSize?: number;
  readonly tick?: number;
  readonly tickCount?: number;
  readonly elapsedMs?: number;
  readonly map?: SnapshotMap;
  readonly getMap?: () => SnapshotMap;
};

const DEFAULT_TILE_SIZE = 32;

const clampCounter = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return value < 0 ? 0 : value;
};

const getSnapshotMap = (sim: SnapshotSim): SnapshotMap | undefined => {
  if (sim.map !== undefined) {
    return sim.map;
  }

  if (typeof sim.getMap === "function") {
    return sim.getMap();
  }

  return undefined;
};

const createOreList = (map: SnapshotMap): ReadonlyArray<Readonly<SnapshotOreCell>> => {
  const cells: SnapshotOreCell[] = [];

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (map.isOre(x, y)) {
        cells.push({ x, y });
      }
    }
  }

  return cells;
};

const extractLightState = (entity: EntityBase): unknown => {
  if (
    entity.state !== undefined &&
    typeof entity.state === "object" &&
    "light" in entity.state
  ) {
    return (entity.state as { readonly light?: unknown }).light;
  }

  return undefined;
};

const createEntitySnapshot = (entity: EntityBase): SnapshotEntity => ({
  id: entity.id,
  kind: entity.kind,
  pos: { x: entity.pos.x, y: entity.pos.y },
  rot: entity.rot,
  light: extractLightState(entity),
});

export const createSnapshot = (sim: SnapshotSim): Snapshot => {
  const map = getSnapshotMap(sim);
  const width = clampCounter(sim.width ?? map?.width);
  const height = clampCounter(sim.height ?? map?.height);
  const tick = clampCounter(sim.tick);
  const tickCount = clampCounter(sim.tickCount);
  const elapsedMs = clampCounter(sim.elapsedMs);
  const tileSize = typeof sim.tileSize === "number" && Number.isFinite(sim.tileSize)
    ? sim.tileSize
    : DEFAULT_TILE_SIZE;

  const ore = map === undefined ? [] : createOreList(map);
  const entities = sim.getAllEntities?.() ?? [];

  return {
    grid: {
      width,
      height,
      tileSize,
    },
    time: {
      tick,
      elapsedMs,
      tickCount,
    },
    ore,
    entities: entities.map(createEntitySnapshot),
  };
};
