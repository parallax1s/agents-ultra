import type {
  Direction,
  EntityBase,
  EntityKind,
  GridCoord,
  ItemKind,
  SimCommittedTiming,
  StartupProbeState,
} from "./types";

export type SnapshotGrid = {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
};

export type SnapshotTiming = {
  readonly tick: number;
  readonly elapsedMs: number;
  readonly tickCount: number;
  readonly revision: number;
};

export type SnapshotProbe = StartupProbeState;

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
  readonly accept?: ItemKind;
  readonly hasOutput?: boolean;
  readonly justMined?: boolean;
  readonly state?: "idle" | "pickup" | "swing" | "drop";
  readonly holding?: ItemKind | null;
  readonly inputOccupied?: boolean;
  readonly outputOccupied?: boolean;
  readonly progress01?: number;
};

export type SnapshotPlayer = {
  readonly x: number;
  readonly y: number;
  readonly fuel: number;
  readonly maxFuel: number;
  readonly rot?: Direction;
};

export type Snapshot = Readonly<{
  readonly grid: SnapshotGrid;
  readonly time: SnapshotTiming;
  readonly probe: SnapshotProbe;
  readonly ore: ReadonlyArray<Readonly<SnapshotOreCell>>;
  readonly coal: ReadonlyArray<Readonly<SnapshotOreCell>>;
  readonly wood: ReadonlyArray<Readonly<SnapshotOreCell>>;
  readonly entities: ReadonlyArray<SnapshotEntity>;
  readonly player?: SnapshotPlayer;
}>;

type SnapshotMap = {
  readonly width: number;
  readonly height: number;
  readonly isOre: (x: number, y: number) => boolean;
  readonly isCoal: (x: number, y: number) => boolean;
  readonly isTree: (x: number, y: number) => boolean;
  readonly getResourceRevision?: () => unknown;
};

type SnapshotSim = {
  readonly getAllEntities?: () => EntityBase[];
  readonly width?: number;
  readonly height?: number;
  readonly tileSize?: number;
  readonly tick?: number;
  readonly tickCount?: number;
  readonly elapsedMs?: number;
  readonly getPlacementSnapshot?: () => { tick?: unknown; tickCount?: unknown; revision?: unknown };
  readonly getStartupProbe?: () => unknown;
  readonly map?: SnapshotMap;
  readonly getMap?: () => SnapshotMap;
  readonly player?: unknown;
  readonly getPlayerSnapshot?: () => unknown;
};

type SnapshotState = Record<string, unknown>;
type SnapshotInserterState = "idle" | "pickup" | "swing" | "drop";

const DEFAULT_TILE_SIZE = 32;

type SnapshotPublicationState = {
  timing: SimCommittedTiming;
  snapshotProbe?: SnapshotProbe;
  snapshot?: Snapshot;
  snapshotWidth?: number;
  snapshotHeight?: number;
  snapshotTileSize?: number;
  snapshotMap?: SnapshotMap;
};

const snapshotStateBySim = new WeakMap<object, SnapshotPublicationState>();

const clampCounter = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return value < 0 ? 0 : value;
};

const clampBoundaryCounter = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  const floored = Math.floor(value);
  return floored < 0 ? 0 : floored;
};

const asCommittedTiming = (
  sim: SnapshotSim,
  proposedTick: number,
  proposedTickCount: number,
  proposedElapsedMs: number,
  proposedRevision: number,
): SnapshotPublicationState => {
  if (!isObject(sim)) {
    return {
      timing: {
        tick: proposedTick,
        tickCount: proposedTickCount,
        elapsedMs: proposedElapsedMs,
        revision: proposedRevision,
      },
    };
  }

  const previous = snapshotStateBySim.get(sim);
  if (previous === undefined) {
    const initialState: SnapshotPublicationState = {
      timing: {
        tick: proposedTick,
        tickCount: proposedTickCount,
        elapsedMs: proposedElapsedMs,
        revision: proposedRevision,
      },
      snapshotProbe: getProbeFromSim(sim),
    };
    snapshotStateBySim.set(sim, initialState);
    return initialState;
  }

  const hasCommittedBoundary =
    proposedTick > previous.timing.tick ||
    proposedTickCount > previous.timing.tickCount ||
    proposedRevision !== previous.timing.revision;
  const nextTiming: SimCommittedTiming = {
    tick: proposedTick > previous.timing.tick ? proposedTick : previous.timing.tick,
    tickCount:
      proposedTickCount > previous.timing.tickCount ? proposedTickCount : previous.timing.tickCount,
    elapsedMs: hasCommittedBoundary ? proposedElapsedMs : previous.timing.elapsedMs,
    revision: hasCommittedBoundary ? proposedRevision : previous.timing.revision,
  };
  previous.timing = nextTiming;
  previous.snapshotProbe = getProbeFromSim(sim);

  return previous;
};

const isObject = (value: unknown): value is SnapshotState => {
  return value !== null && typeof value === "object";
};

const asSnapshotState = (value: unknown): SnapshotState | undefined => {
  return isObject(value) ? value : undefined;
};

const cloneSnapshotValue = (value: unknown, seen = new WeakMap<object, unknown>()): unknown => {
  if (typeof value === "function") {
    return undefined;
  }

  if (!isObject(value)) {
    return value;
  }

  const existing = seen.get(value);
  if (existing !== undefined) {
    return existing;
  }

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    seen.set(value, clone);
    for (const entry of value) {
      clone.push(cloneSnapshotValue(entry, seen));
    }
    return clone;
  }

  const clone: SnapshotState = {};
  seen.set(value, clone);
  for (const key of Object.keys(value)) {
    clone[key] = cloneSnapshotValue((value as SnapshotState)[key], seen);
  }

  return clone;
};

const isItemKind = (value: unknown): value is ItemKind => {
  return (
    value === "iron-ore" ||
    value === "iron-plate" ||
    value === "coal" ||
    value === "iron-gear" ||
    value === "wood"
  );
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

const getPlacementTiming = (
  sim: SnapshotSim,
): { tick?: unknown; tickCount?: unknown; revision?: unknown } | undefined => {
  if (typeof sim.getPlacementSnapshot !== "function") {
    return undefined;
  }

  try {
    const snapshot = sim.getPlacementSnapshot();
    if (isObject(snapshot)) {
      return {
        tick: snapshot.tick,
        tickCount: snapshot.tickCount,
        revision: snapshot.revision,
      };
    }
  } catch {
    return undefined;
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

const createCoalList = (map: SnapshotMap): ReadonlyArray<Readonly<SnapshotOreCell>> => {
  const cells: SnapshotOreCell[] = [];

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (map.isCoal(x, y)) {
        cells.push({ x, y });
      }
    }
  }

  return cells;
};

const createWoodList = (map: SnapshotMap): ReadonlyArray<Readonly<SnapshotOreCell>> => {
  const cells: SnapshotOreCell[] = [];

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (map.isTree(x, y)) {
        cells.push({ x, y });
      }
    }
  }

  return cells;
};

const toFiniteInt = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.floor(value);
};

const createPlayerSnapshot = (sim: SnapshotSim): SnapshotPlayer | undefined => {
  let source: unknown = undefined;
  if (typeof sim.getPlayerSnapshot === "function") {
    try {
      source = sim.getPlayerSnapshot();
    } catch {
      source = undefined;
    }
  }

  if (source === undefined) {
    source = sim.player;
  }

  if (!isObject(source)) {
    return undefined;
  }

  const x = toFiniteInt((source as SnapshotState).x);
  const y = toFiniteInt((source as SnapshotState).y);
  const fuel = toFiniteInt((source as SnapshotState).fuel);
  const maxFuel = toFiniteInt((source as SnapshotState).maxFuel);
  const rawRot = (source as SnapshotState).rot;
  const rot = rawRot === "N" || rawRot === "E" || rawRot === "S" || rawRot === "W"
    ? rawRot
    : undefined;
  if (x === null || y === null || fuel === null || maxFuel === null) {
    return undefined;
  }

  return {
    x,
    y,
    fuel: fuel < 0 ? 0 : fuel,
    maxFuel: maxFuel < 1 ? 1 : maxFuel,
    ...(rot === undefined ? {} : { rot }),
  };
};

const asStartupProbeState = (value: unknown): SnapshotProbe | undefined => {
  if (!isObject(value)) {
    return undefined;
  }

  const candidate = value as {
    phase?: unknown;
    error?: unknown;
  };

  if (
    candidate.phase !== "init" &&
    candidate.phase !== "sim-ready" &&
    candidate.phase !== "renderer-ready" &&
    candidate.phase !== "input-ready" &&
    candidate.phase !== "running" &&
    candidate.phase !== "error"
  ) {
    return undefined;
  }

  if (candidate.error !== undefined && typeof candidate.error !== "string") {
    return undefined;
  }

  return {
    phase: candidate.phase,
    ...(candidate.error === undefined ? {} : { error: candidate.error }),
  };
};

const getProbeFromSim = (sim: SnapshotSim): SnapshotProbe => {
  if (typeof sim.getStartupProbe === "function") {
    const probe = sim.getStartupProbe();
    const normalized = asStartupProbeState(probe);
    if (normalized !== undefined) {
      return normalized;
    }
  }

  const tick = clampBoundaryCounter(sim.tick);
  return {
    phase: tick > 0 ? "running" : "init",
  };
};

type CachedResourceList = Map<number, ReadonlyArray<Readonly<SnapshotOreCell>>>;

const oreListCache = new WeakMap<object, CachedResourceList>();
const coalListCache = new WeakMap<object, CachedResourceList>();
const woodListCache = new WeakMap<object, CachedResourceList>();

const getMapResourceRevision = (map: SnapshotMap): number => {
  const rawRevision = typeof map.getResourceRevision === "function" ? map.getResourceRevision() : 0;
  if (typeof rawRevision === "number" && Number.isInteger(rawRevision) && rawRevision >= 0) {
    return rawRevision;
  }

  if (typeof rawRevision === "string") {
    const parsed = Number.parseInt(rawRevision, 10);
    return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  }

  return 0;
};

const getCachedResourceList = <T>(
  cacheMap: WeakMap<object, CachedResourceList>,
  map: SnapshotMap,
  createList: (value: SnapshotMap) => ReadonlyArray<T>,
): ReadonlyArray<T> => {
  const cacheKey = map as object;
  const revision = getMapResourceRevision(map);
  const revisionCache = cacheMap.get(cacheKey);
  const cached = revisionCache?.get(revision);

  if (cached !== undefined) {
    return cached as ReadonlyArray<T>;
  }

  const nextRevisionCache = revisionCache === undefined ? new Map<number, ReadonlyArray<Readonly<SnapshotOreCell>>>() : new Map(revisionCache);
  const computed = createList(map) as ReadonlyArray<T>;
  nextRevisionCache.set(revision, computed);
  cacheMap.set(cacheKey, nextRevisionCache);
  return computed;
};

const getCachedOreList = (map: SnapshotMap): ReadonlyArray<Readonly<SnapshotOreCell>> => {
  return getCachedResourceList(oreListCache, map, createOreList);
};

const getCachedCoalList = (map: SnapshotMap): ReadonlyArray<Readonly<SnapshotOreCell>> => {
  return getCachedResourceList(coalListCache, map, createCoalList);
};

const getCachedWoodList = (map: SnapshotMap): ReadonlyArray<Readonly<SnapshotOreCell>> => {
  return getCachedResourceList(woodListCache, map, createWoodList);
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

const extractBeltAccept = (state: SnapshotState | undefined): ItemKind | undefined => {
  if (!isItemKind(state?.accept)) {
    return undefined;
  }

  return state.accept;
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

const extractMinerJustMined = (state: SnapshotState | undefined): boolean | undefined => {
  if (state === undefined) {
    return undefined;
  }

  return state.justMined === true ? true : undefined;
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

const deepFreezeSnapshot = (value: unknown, seen = new WeakSet<object>()): void => {
  if (!isObject(value) || seen.has(value)) {
    return;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreezeSnapshot(item, seen);
    }
    Object.freeze(value);
    return;
  }

  for (const key of Object.keys(value)) {
    deepFreezeSnapshot((value as SnapshotState)[key], seen);
  }

  Object.freeze(value);
};

const createEntitySnapshot = (entity: EntityBase): SnapshotEntity => {
  const entityState = asSnapshotState(entity.state);
  const baseSnapshot: SnapshotEntity = {
    id: entity.id,
    kind: entity.kind,
    pos: { x: entity.pos.x, y: entity.pos.y },
    rot: entity.rot,
    light: cloneSnapshotValue(extractLightState(entity)),
  };

  if (entity.kind === "belt" || entity.kind === "splitter") {
    const accept = extractBeltAccept(entityState);
    return {
      ...baseSnapshot,
      items: extractBeltItems(entityState),
      ...(accept === undefined ? {} : { accept }),
    };
  }

  if (entity.kind === "miner") {
    const hasOutput = extractMinerHasOutput(entityState);
    const justMined = extractMinerJustMined(entityState);
    return {
      ...baseSnapshot,
      ...(hasOutput === undefined ? {} : { hasOutput }),
      ...(justMined === true ? { justMined: true } : {}),
    };
  }

  if (entity.kind === "inserter") {
    return {
      ...baseSnapshot,
      state: extractInserterState(entity.state),
      holding: extractInserterHolding(entityState),
    };
  }

  if (entity.kind === "furnace" || entity.kind === "assembler") {
    return {
      ...baseSnapshot,
      inputOccupied: extractFurnaceBooleanField(entityState, "inputOccupied") ?? false,
      outputOccupied: extractFurnaceBooleanField(entityState, "outputOccupied") ?? false,
      progress01: extractFurnaceProgress(entityState),
    };
  }

  return baseSnapshot;
};

const compareSnapshotEntityIds = (left: EntityBase, right: EntityBase): number => {
  const leftValue = Number(left.id);
  const rightValue = Number(right.id);
  if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
    return leftValue - rightValue;
  }
  return left.id.localeCompare(right.id);
};

export const createSnapshot = (sim: SnapshotSim): Snapshot => {
  const map = getSnapshotMap(sim);
  const width = clampCounter(sim.width ?? map?.width);
  const height = clampCounter(sim.height ?? map?.height);
  const placement = getPlacementTiming(sim);
  const tick = clampBoundaryCounter(placement?.tick ?? sim.tick);
  const tickCount = clampBoundaryCounter(placement?.tickCount ?? sim.tickCount);
  const elapsedMs = clampCounter(sim.elapsedMs);
  const tileSize = typeof sim.tileSize === "number" && Number.isFinite(sim.tileSize)
    ? sim.tileSize
    : DEFAULT_TILE_SIZE;
  const revision = clampBoundaryCounter(placement?.revision);
  const timing = asCommittedTiming(sim, tick, tickCount, elapsedMs, revision);
  if (
    timing.snapshot !== undefined &&
    timing.timing.tick === timing.snapshot.time.tick &&
    timing.timing.revision === timing.snapshot.time.revision &&
    timing.timing.tickCount === timing.snapshot.time.tickCount &&
    timing.snapshotWidth === width &&
    timing.snapshotHeight === height &&
    timing.snapshotTileSize === tileSize &&
    timing.snapshotMap === map &&
    timing.snapshotProbe !== undefined &&
    timing.snapshotProbe.phase === timing.snapshot.probe.phase &&
    timing.snapshotProbe.error === timing.snapshot.probe.error
  ) {
    return timing.snapshot;
  }

  const ore = map === undefined ? [] : getCachedOreList(map);
  const coal = map === undefined ? [] : getCachedCoalList(map);
  const wood = map === undefined ? [] : getCachedWoodList(map);
  const entities = sim.getAllEntities?.() ?? [];
  const player = createPlayerSnapshot(sim);

  const snapshot: Snapshot = {
    grid: {
      width,
      height,
      tileSize,
    },
    time: {
      tick: timing.timing.tick,
      elapsedMs: timing.timing.elapsedMs,
      tickCount: timing.timing.tickCount,
      revision: timing.timing.revision,
    },
    probe: getProbeFromSim(sim),
    ore,
    coal,
    wood,
    entities: entities.slice().sort(compareSnapshotEntityIds).map(createEntitySnapshot),
    ...(player === undefined ? {} : { player }),
  };

  deepFreezeSnapshot(snapshot);
  if (isObject(sim)) {
    timing.snapshot = snapshot;
    timing.snapshotWidth = width;
    timing.snapshotHeight = height;
    timing.snapshotTileSize = tileSize;
    timing.snapshotMap = map;
    timing.snapshotProbe = snapshot.probe;
  }
  return snapshot;
};
