import type { Direction, EntityBase, EntityKind, GridCoord, ItemKind } from "./types";

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
  readonly items?: ReadonlyArray<ItemKind | null>;
  readonly hasOutput?: boolean;
  readonly state?: "idle" | "pickup" | "swing" | "drop";
  readonly holding?: ItemKind | null;
  readonly inputOccupied?: boolean;
  readonly outputOccupied?: boolean;
  readonly progress01?: number;
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

type SnapshotState = Record<string, unknown>;
type SnapshotInserterState = "idle" | "pickup" | "swing" | "drop";

const DEFAULT_TILE_SIZE = 32;

const clampCounter = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return value < 0 ? 0 : value;
};

const isObject = (value: unknown): value is SnapshotState => {
  return value !== null && typeof value === "object";
};

const asSnapshotState = (value: unknown): SnapshotState | undefined => {
  return isObject(value) ? value : undefined;
};

const isItemKind = (value: unknown): value is ItemKind => {
  return value === "iron-ore" || value === "iron-plate";
};

const clampProgress01 = (value: number): number => {
  if (value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
};

const asItemList = (value: unknown): ReadonlyArray<ItemKind | null> | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.map((entry) => {
    return isItemKind(entry) ? entry : null;
  });
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
  const state = asSnapshotState(entity.state);
  if (state !== undefined && "light" in state) {
    return (state as { readonly light?: unknown }).light;
  }

  return undefined;
};

const extractBeltItems = (state: SnapshotState | undefined): ReadonlyArray<ItemKind | null> => {
  if (state === undefined) {
    return [];
  }

  const byItems = asItemList(state.items);
  if (byItems !== undefined) {
    return byItems;
  }

  return asItemList(state.slots) ?? [];
};

const extractMinerHasOutput = (state: SnapshotState | undefined): boolean | undefined => {
  if (state === undefined) {
    return undefined;
  }

  if (typeof state.hasOutput === "boolean") {
    return state.hasOutput;
  }

  if ("output" in state) {
    const output = state.output;
    if (typeof output === "boolean") {
      return output;
    }

    if (isItemKind(output)) {
      return true;
    }
    if (output === null) {
      return false;
    }
  }

  return undefined;
};

const extractInserterState = (state: unknown): SnapshotInserterState => {
  const inserterState = asSnapshotState(state);
  if (inserterState === undefined) {
    return "idle";
  }

  const rawState = inserterState.state;
  if (typeof rawState === "number") {
    if (rawState === 1) {
      return "pickup";
    }
    if (rawState === 2) {
      return "swing";
    }
    if (rawState === 3) {
      return "drop";
    }
    return "idle";
  }

  if (rawState === "pickup" || rawState === "swing" || rawState === "drop") {
    return rawState;
  }

  return "idle";
};

const extractInserterHolding = (state: SnapshotState | undefined): ItemKind | null => {
  if (state === undefined) {
    return null;
  }

  const candidates = [state.holding, state.carried, state.item];
  for (const candidate of candidates) {
    if (isItemKind(candidate)) {
      return candidate;
    }
  }

  return null;
};

const extractFurnaceBooleanField = (state: SnapshotState | undefined, key: "inputOccupied" | "outputOccupied"): boolean | undefined => {
  if (state === undefined) {
    return undefined;
  }

  const direct = state[key];
  if (typeof direct === "boolean") {
    return direct;
  }

  const legacy = state[key === "inputOccupied" ? "input" : "output"];
  if (typeof legacy === "boolean") {
    return legacy;
  }

  return undefined;
};

const extractFurnaceProgress = (state: SnapshotState | undefined): number => {
  if (state === undefined) {
    return 0;
  }

  const direct = state.progress01;
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return clampProgress01(direct);
  }

  const rawProgress = state.progress;
  if (typeof rawProgress === "number" && Number.isFinite(rawProgress)) {
    return clampProgress01(rawProgress);
  }

  return 0;
};

const createEntitySnapshot = (entity: EntityBase): SnapshotEntity => {
  const entityState = asSnapshotState(entity.state);
  const baseSnapshot: SnapshotEntity = {
    id: entity.id,
    kind: entity.kind,
    pos: { x: entity.pos.x, y: entity.pos.y },
    rot: entity.rot,
    light: extractLightState(entity),
  };

  if (entity.kind === "belt") {
    return {
      ...baseSnapshot,
      items: extractBeltItems(entityState),
    };
  }

  if (entity.kind === "miner") {
    const hasOutput = extractMinerHasOutput(entityState);
    return {
      ...baseSnapshot,
      ...(hasOutput === undefined ? {} : { hasOutput }),
    };
  }

  if (entity.kind === "inserter") {
    return {
      ...baseSnapshot,
      state: extractInserterState(entity.state),
      holding: extractInserterHolding(entityState),
    };
  }

  if (entity.kind === "furnace") {
    return {
      ...baseSnapshot,
      inputOccupied: extractFurnaceBooleanField(entityState, "inputOccupied") ?? false,
      outputOccupied: extractFurnaceBooleanField(entityState, "outputOccupied") ?? false,
      progress01: extractFurnaceProgress(entityState),
    };
  }

  return baseSnapshot;
};

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
