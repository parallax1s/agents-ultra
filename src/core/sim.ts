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
  StartupProbeState,
} from "./types";

type CreateSimConfig = {
  width?: number;
  height?: number;
  seed?: number | string;
  map?: GeneratedMap;
  restore?: {
    tick?: unknown;
    tickCount?: unknown;
    elapsedMs?: unknown;
    paused?: unknown;
    accumulatorMs?: unknown;
    entities?: unknown;
    power?: {
      storage?: unknown;
      capacity?: unknown;
    };
  };
};

type PowerBuckets = Record<string, number>;

type SimPowerState = {
  storage: number;
  capacity: number;
  demandThisTick: number;
  consumedThisTick: number;
  generatedThisTick: number;
  networkProducers: number;
  networkConsumers: number;
  networkConnectedConsumers: number;
  networkDisconnectedConsumers: number;
  demandTotal: number;
  consumedTotal: number;
  generatedTotal: number;
  shortagesTotal: number;
  demandByKind: PowerBuckets;
  consumedByKind: PowerBuckets;
  generatedByKind: PowerBuckets;
  shortagesThisTick: number;
};

type EntityInit = {
  pos: GridCoord;
  rot?: Direction;
  state?: unknown;
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
const DEFAULT_POWER_CAPACITY = 180;
const DEFAULT_POWER_STORAGE = 120;
const ACCUMULATOR_POWER_CAPACITY = 120;
const POWER_NET_NEIGHBOR_OFFSETS: ReadonlyArray<GridCoord> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

const createDefaultPowerNetworkState = (): {
  producers: number;
  consumers: number;
  connectedConsumers: number;
  disconnectedConsumers: number;
} => ({
  producers: 0,
  consumers: 0,
  connectedConsumers: 0,
  disconnectedConsumers: 0,
});

const isPowerProducerKind = (kind: string): boolean => kind === "solar-panel";
const isPowerConsumerKind = (kind: string): boolean =>
  kind === "miner" ||
  kind === "belt" ||
  kind === "splitter" ||
  kind === "inserter" ||
  kind === "furnace" ||
  kind === "assembler";

type PowerNetworkAnalysis = {
  producers: number;
  consumers: number;
  connectedConsumers: number;
  disconnectedConsumers: number;
  connectedConsumerIds: Set<string>;
};

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

const isObject = (value: unknown): value is Record<string, unknown> => {
  return value !== null && typeof value === "object";
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

type RestoreEntity = {
  kind: EntityKind | (string & {});
  pos: GridCoord;
  rot?: unknown;
  state?: unknown;
};

const isRestoreEntity = (value: unknown): value is RestoreEntity => {
  if (!isObject(value)) {
    return false;
  }

  return (
    typeof value.kind === "string" &&
    value.kind.length > 0 &&
    isGridCoord(value.pos)
  );
};

export const createSim = ({
  width,
  height,
  seed,
  map,
  restore,
}: CreateSimConfig = {}) => {
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
  let powerCapacity = DEFAULT_POWER_CAPACITY;
  let powerCapacityBase = DEFAULT_POWER_CAPACITY;
  let powerStorage = DEFAULT_POWER_STORAGE;
  let powerDemandThisTick = 0;
  let powerConsumedThisTick = 0;
  let powerGeneratedThisTick = 0;
  let powerNetworkState = createDefaultPowerNetworkState();
  let powerDemandTotal = 0;
  let powerConsumedTotal = 0;
  let powerGeneratedTotal = 0;
  let powerShortagesTotal = 0;
  let powerDemandByKind: PowerBuckets = {};
  let powerConsumedByKind: PowerBuckets = {};
  let powerGeneratedByKind: PowerBuckets = {};
  let powerShortagesThisTick = 0;
  let powerConnectedConsumerIds: Set<string> = new Set();
  const insertionOrderById = new Map<string, number>();
  let startupProbeState: StartupProbeState = { phase: "init" };

  const normalizeErrorMessage = (cause: unknown): string | undefined => {
    if (cause instanceof Error) {
      return cause.message || undefined;
    }
    if (typeof cause === "string") {
      return cause || undefined;
    }
    return undefined;
  };

  const advanceStartupProbeState = (): void => {
    if (startupProbeState.phase === "error") {
      return;
    }

    if (startupProbeState.phase === "init") {
      startupProbeState = { phase: "sim-ready" };
      return;
    }

    if (startupProbeState.phase === "sim-ready" && tick >= 1) {
      startupProbeState = { phase: "renderer-ready" };
      return;
    }

    if (startupProbeState.phase === "renderer-ready" && tick >= 2) {
      startupProbeState = { phase: "input-ready" };
      return;
    }

    if (startupProbeState.phase === "input-ready") {
      startupProbeState = { phase: "running" };
    }
  };

  const markStartupProbeError = (cause: unknown): void => {
    startupProbeState = {
      phase: "error",
      error: normalizeErrorMessage(cause),
    };
  };

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

  const ensureRestoreDirection = (value: unknown): Direction => {
    if (value === "N" || value === "E" || value === "S" || value === "W") {
      return value;
    }
    return DEFAULT_ROTATION;
  };

  const clampRestoreInteger = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, Math.floor(value));
  };

  const clampRestoreFloat = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return 0;
    }
    return Math.max(0, value);
  };

  const hydrateState = (targetState: unknown, sourceState: unknown): void => {
    if (!isObject(targetState) || !isObject(sourceState)) {
      return;
    }

    const normalizedSource = cloneSnapshotValue(sourceState);
    if (!isObject(normalizedSource)) {
      return;
    }

    for (const key of Object.keys(normalizedSource)) {
      targetState[key] = normalizedSource[key];
    }
  };

  const mergeState = (target: unknown, source: unknown): unknown => {
    if (target === undefined) {
      return cloneSnapshotValue(source);
    }

    hydrateState(target, source);
    return target;
  };

  const normalizePowerPositive = (value: unknown, fallback: number): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return fallback;
    }

    return Math.max(0, Math.floor(value));
  };

  const normalizePowerCapacity = (value: unknown): number => {
    const normalized = normalizePowerPositive(value, DEFAULT_POWER_CAPACITY);
    return Math.max(1, normalized);
  };

  const computePowerCapacityWithAccumulators = (accumulatorCount: number): number => {
    const accumulatorCapacity = Math.max(0, Math.floor(accumulatorCount)) * ACCUMULATOR_POWER_CAPACITY;
    return Math.max(1, powerCapacityBase + accumulatorCapacity);
  };

  const applyDynamicPowerCapacity = (accumulatorCount: number): void => {
    powerCapacity = computePowerCapacityWithAccumulators(accumulatorCount);
    if (powerStorage > powerCapacity) {
      powerStorage = powerCapacity;
    }
  };

  const resetTickPowerAccounting = (): void => {
    powerDemandThisTick = 0;
    powerConsumedThisTick = 0;
    powerGeneratedThisTick = 0;
    powerDemandByKind = {};
    powerConsumedByKind = {};
    powerGeneratedByKind = {};
    powerShortagesThisTick = 0;
  };

  const addPowerRecord = (records: PowerBuckets, kind: string, amount: number): void => {
    if (amount <= 0) {
      return;
    }

    records[kind] = (records[kind] ?? 0) + amount;
  };

  const getSimPowerState = (): SimPowerState => {
    return {
      storage: powerStorage,
      capacity: powerCapacity,
      demandThisTick: powerDemandThisTick,
      consumedThisTick: powerConsumedThisTick,
      generatedThisTick: powerGeneratedThisTick,
      networkProducers: powerNetworkState.producers,
      networkConsumers: powerNetworkState.consumers,
      networkConnectedConsumers: powerNetworkState.connectedConsumers,
      networkDisconnectedConsumers: powerNetworkState.disconnectedConsumers,
      demandTotal: powerDemandTotal,
      consumedTotal: powerConsumedTotal,
      generatedTotal: powerGeneratedTotal,
      shortagesTotal: powerShortagesTotal,
      demandByKind: { ...powerDemandByKind },
      consumedByKind: { ...powerConsumedByKind },
      generatedByKind: { ...powerGeneratedByKind },
      shortagesThisTick: powerShortagesThisTick,
    };
  };

  const consumePower = (amount: unknown, kind = "unknown", consumerId?: unknown): boolean => {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return true;
    }

    const requested = Math.floor(amount);
    powerDemandThisTick += requested;
    powerDemandTotal += requested;
    addPowerRecord(powerDemandByKind, kind, requested);

    if (typeof consumerId === "string" && !powerConnectedConsumerIds.has(consumerId)) {
      powerShortagesThisTick += 1;
      powerShortagesTotal += 1;
      return false;
    }

    if (requested > powerStorage) {
      powerShortagesThisTick += 1;
      powerShortagesTotal += 1;
      return false;
    }

    powerStorage -= requested;
    powerConsumedThisTick += requested;
    powerConsumedTotal += requested;
    addPowerRecord(powerConsumedByKind, kind, requested);
    return true;
  };

  const generatePower = (amount: unknown, kind = "unknown"): number => {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return 0;
    }

    const requested = Math.floor(amount);
    const availableCapacity = Math.max(0, powerCapacity - powerStorage);
    const granted = Math.min(requested, availableCapacity);
    powerStorage += granted;
    powerGeneratedThisTick += granted;
    powerGeneratedTotal += granted;
    addPowerRecord(powerGeneratedByKind, kind, granted);
    return granted;
  };

  const clearEntities = (): void => {
    entitiesById.clear();
    entitiesByCell.clear();
    cellKeyById.clear();
    publicEntitiesById.clear();
    publicEntitiesByCell.clear();
    publicCellKeyById.clear();
    insertionOrderById.clear();
    nextEntityId = 1;
    nextEntityInsertionOrder = 0;
  };

  const resetStartupProbeForRestore = (): void => {
    startupProbeState = tick > 0 || tickCount > 0 ? { phase: "running" } : { phase: "init" };
  };

  const applyPowerNetworkState = (payload: {
    producers?: unknown;
    consumers?: unknown;
    connectedConsumers?: unknown;
    disconnectedConsumers?: unknown;
  }): void => {
    const safeState = createDefaultPowerNetworkState();

    if (typeof payload?.producers === "number" && Number.isFinite(payload.producers)) {
      safeState.producers = Math.max(0, Math.floor(payload.producers));
    }
    if (typeof payload?.consumers === "number" && Number.isFinite(payload.consumers)) {
      safeState.consumers = Math.max(0, Math.floor(payload.consumers));
    }
    if (typeof payload?.connectedConsumers === "number" && Number.isFinite(payload.connectedConsumers)) {
      safeState.connectedConsumers = Math.max(0, Math.floor(payload.connectedConsumers));
    }
    if (
      typeof payload?.disconnectedConsumers === "number" &&
      Number.isFinite(payload.disconnectedConsumers)
    ) {
      safeState.disconnectedConsumers = Math.max(0, Math.floor(payload.disconnectedConsumers));
    }

    powerNetworkState = safeState;
  };

  const computePowerNetworkState = (): PowerNetworkAnalysis => {
    const powerNodeIds = new Set<string>();
    const producers = new Set<string>();
    const consumers = new Set<string>();
    const connectedConsumerIds = new Set<string>();
    const nodesByCell = new Map<string, Set<string>>();
    const nodesById = new Map<string, { x: number; y: number; isConsumer: boolean; isProducer: boolean }>();

    for (const [id, entity] of entitiesById) {
      const kind = String(entity.kind);
      const isProducer = isPowerProducerKind(kind);
      const isConsumer = isPowerConsumerKind(kind);

      if (!isProducer && !isConsumer) {
        continue;
      }

      const cellKey = toCellKey(entity.pos);
      powerNodeIds.add(id);

      if (isProducer) {
        producers.add(id);
      }
      if (isConsumer) {
        consumers.add(id);
      }

      nodesById.set(id, {
        x: entity.pos.x,
        y: entity.pos.y,
        isConsumer,
        isProducer,
      });

      let cellMembers = nodesByCell.get(cellKey);
      if (cellMembers === undefined) {
        cellMembers = new Set<string>();
        nodesByCell.set(cellKey, cellMembers);
      }
      cellMembers.add(id);
    }

    if (producers.size === 0) {
      return {
        producers: 0,
        consumers: consumers.size,
        connectedConsumers: 0,
        disconnectedConsumers: consumers.size,
        connectedConsumerIds,
      };
    }

    const searchQueue: string[] = Array.from(producers);
    const visited = new Set<string>(searchQueue);

    while (searchQueue.length > 0) {
      const nodeId = searchQueue.shift();
      if (nodeId === undefined) {
        continue;
      }

      const node = nodesById.get(nodeId);
      if (node === undefined) {
        continue;
      }

      if (node.isConsumer) {
        connectedConsumerIds.add(nodeId);
      }

      const adjacentKeys = POWER_NET_NEIGHBOR_OFFSETS.map(({ x, y }) =>
        toCellKey({ x: node.x + x, y: node.y + y }),
      );

      for (const adjacentKey of adjacentKeys) {
        const adjacentNodeIds = nodesByCell.get(adjacentKey);
        if (adjacentNodeIds === undefined) {
          continue;
        }

        for (const adjacentId of adjacentNodeIds) {
          if (visited.has(adjacentId)) {
            continue;
          }

          const adjacentNode = nodesById.get(adjacentId);
          if (adjacentNode === undefined) {
            continue;
          }

          if (!nodesById.has(adjacentId) || !powerNodeIds.has(adjacentId)) {
            continue;
          }

          if (adjacentNode.isProducer || adjacentNode.isConsumer) {
            visited.add(adjacentId);
            searchQueue.push(adjacentId);
          }
        }
      }
    }

    const connectedConsumers = connectedConsumerIds.size;
    const totalConsumers = consumers.size;

    return {
      producers: producers.size,
      consumers: totalConsumers,
      connectedConsumers,
      disconnectedConsumers: Math.max(0, totalConsumers - connectedConsumers),
      connectedConsumerIds,
    };
  };

  let isRestoring = false;

  const restoreFromPayload = (payload: CreateSimConfig["restore"]): void => {
    if (!isObject(payload) || isRestoring) {
      return;
    }

    isRestoring = true;
    try {
      clearEntities();
      paused = payload.paused === true;
      tick = clampRestoreInteger(payload.tick);
      tickCount = clampRestoreInteger(payload.tickCount);
      elapsedMs = clampRestoreFloat(payload.elapsedMs);
      accumulatorMs = clampRestoreFloat(payload.accumulatorMs);
          powerCapacityBase = normalizePowerCapacity(payload.power?.capacity);
          powerStorage = normalizePowerPositive(payload.power?.storage, DEFAULT_POWER_STORAGE);
          powerDemandTotal = normalizePowerPositive(payload.power?.demandTotal, 0);
      powerConsumedTotal = normalizePowerPositive(payload.power?.consumedTotal, 0);
      powerGeneratedTotal = normalizePowerPositive(payload.power?.generatedTotal, 0);
      powerShortagesTotal = normalizePowerPositive(payload.power?.shortagesTotal, 0);
      powerStorage = Math.min(powerStorage, powerCapacityBase);
      powerStorage = Math.max(0, powerStorage);
      applyDynamicPowerCapacity(0);
      resetTickPowerAccounting();

      const rawEntities = payload.entities;
      if (Array.isArray(rawEntities)) {
        for (const rawEntity of rawEntities) {
          if (!isRestoreEntity(rawEntity)) {
            continue;
          }

          if (isOutOfBounds(rawEntity.pos, worldWidth, worldHeight)) {
            continue;
          }

          const candidateKind = rawEntity.kind;
          if (getDefinition(candidateKind) === undefined) {
            continue;
          }

          addEntity(candidateKind, {
            pos: {
              x: rawEntity.pos.x,
              y: rawEntity.pos.y,
            },
            rot: ensureRestoreDirection(rawEntity.rot),
            state: rawEntity.state,
          });
        }
      }

      let restoredAccumulatorCount = 0;
      for (const entity of entitiesById.values()) {
        if (entity.kind === "accumulator") {
          restoredAccumulatorCount += 1;
        }
      }
      applyDynamicPowerCapacity(restoredAccumulatorCount);
      resetStartupProbeForRestore();
      publishPublicState();
    } finally {
      isRestoring = false;
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
      ...(createdState === undefined ? {} : { state: mergeState(createdState, init.state) }),
    } as EntityBase;

    entitiesById.set(id, entity);
    indexInCell(id, entity.pos, {
      entitiesByCell,
      cellKeyById,
    });
    if (!isRestoring) {
      publishAfterMutation();
    }

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
      advanceStartupProbeState();
      resetTickPowerAccounting();
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

      let accumulatorCount = 0;
      for (const entitySnapshot of tickStartEntitySnapshotById.values()) {
        if (entitySnapshot.kind === "accumulator") {
          accumulatorCount += 1;
        }
      }
      applyDynamicPowerCapacity(accumulatorCount);

      const network = computePowerNetworkState();
      powerNetworkState = {
        producers: network.producers,
        consumers: network.consumers,
        connectedConsumers: network.connectedConsumers,
        disconnectedConsumers: network.disconnectedConsumers,
      };
      powerConnectedConsumerIds = network.connectedConsumerIds;

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
        consumePower,
        generatePower,
        isPowerConsumerConnected: (entityId: string): boolean =>
          powerConnectedConsumerIds.has(entityId),
        getPowerState: getSimPowerState,
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
      advanceStartupProbeState();
      publishPublicState();
    } catch (error) {
      markStartupProbeError(error);
      throw error;
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

    if (restore !== undefined) {
      restoreFromPayload(restore);
    }

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
    restoreState(payload: CreateSimConfig["restore"]): void {
      restoreFromPayload(payload);
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
    getStartupProbe(): StartupProbeState {
      return {
        phase: startupProbeState.phase,
        ...(startupProbeState.error === undefined ? {} : { error: startupProbeState.error }),
      };
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
    get powerStorage(): number {
      return powerStorage;
    },
    get powerCapacity(): number {
      return powerCapacity;
    },
    consumePower,
    generatePower,
    getPowerState(): SimPowerState {
      return getSimPowerState();
    },
    setPowerNetworkState(payload: {
      producers?: unknown;
      consumers?: unknown;
      connectedConsumers?: unknown;
      disconnectedConsumers?: unknown;
    }): void {
      applyPowerNetworkState(payload);
    },
    step,
  };

  return sim;
};

export type Sim = ReturnType<typeof createSim>;
