import {
  CANONICAL_TICK_PHASES,
  registerEntity,
  getDefinition,
} from "../core/registry";
import { sortByGridEntityOrder } from "../core/map";
import { DIRECTION_VECTORS, OPPOSITE_DIRECTION } from "../core/types";
import type { Direction, EntityBase, GridCoord, ItemKind } from "../core/types";
import { Furnace, FURNACE_TYPE } from "./furnace";

const MINER_CADENCE_TICKS = 60;
const BELT_TRANSFER_CADENCE_TICKS = 15;
const INSERTER_CADENCE_TICKS = 20;

type CanonicalTickKind = "miner" | "belt" | "inserter" | "furnace";

type SimLike = {
  readonly getEntitiesAt?: (pos: GridCoord) => EntityBase[];
  readonly getLiveEntitiesAt?: (pos: GridCoord) => EntityBase[];
  readonly getAllEntities?: () => EntityBase[];
  readonly getLiveAllEntities?: () => EntityBase[];
  readonly tick?: number;
  readonly tickCount?: number;
  readonly map?: {
    readonly isOre?: (x: number, y: number) => boolean;
  };
  readonly getMap?: () => {
    readonly isOre?: (x: number, y: number) => boolean;
  };
};

type TickPhaseState = {
  runningTick: number | null;
  inProgress: boolean;
};

const tickState = new WeakMap<object, TickPhaseState>();
const canonicalPhaseKinds: ReadonlyArray<CanonicalTickKind> = ["miner", "belt", "inserter", "furnace"];

const isCanonicalTickKind = (kind: EntityBase["kind"]): kind is CanonicalTickKind => {
  return kind === "miner" || kind === "belt" || kind === "inserter" || kind === "furnace";
};

const compareSimTick = (sim: SimLike): number => {
  if (typeof sim.tick === "number" && Number.isInteger(sim.tick) && sim.tick >= 0) {
    return sim.tick;
  }

  if (typeof sim.tickCount === "number" && Number.isInteger(sim.tickCount) && sim.tickCount >= 0) {
    return sim.tickCount;
  }

  return 0;
};

const createTickState = (): TickPhaseState => ({ runningTick: null, inProgress: false });

const getTickState = (sim: SimLike): TickPhaseState => {
  const state = tickState.get(sim as object);
  if (state !== undefined) {
    return state;
  }

  const nextState = createTickState();
  tickState.set(sim as object, nextState);
  return nextState;
};

const getEntitiesForTick = (sim: SimLike): EntityBase[] => {
  const getAll =
    typeof sim.getLiveAllEntities === "function" ? sim.getLiveAllEntities : sim.getAllEntities;

  if (typeof getAll !== "function") {
    return [];
  }

  const allEntities = getAll();
  return Array.isArray(allEntities) ? allEntities : [];
};

const sortPhaseCandidates = (entities: ReadonlyArray<EntityBase>): EntityBase[] =>
  sortByGridEntityOrder(entities);

const canonicalEntitiesByKind = (sim: SimLike): Record<CanonicalTickKind, EntityBase[]> => {
  const grouped: Record<CanonicalTickKind, EntityBase[]> = {
    miner: [],
    belt: [],
    inserter: [],
    furnace: [],
  };

  for (const entity of getEntitiesForTick(sim)) {
    if (!isCanonicalTickKind(entity.kind)) {
      continue;
    }
    grouped[entity.kind].push(entity);
  }

  for (const kind of canonicalPhaseKinds) {
    grouped[kind] = sortPhaseCandidates(grouped[kind]);
  }

  return grouped;
};

type MinerState = Record<string, unknown> & {
  tickPhase: number;
  hasOutput: boolean;
  output: ItemKind | null;
  light: "on";
};

type BeltState = Record<string, unknown> & {
  tickPhase: number;
  item: ItemKind | null;
  items: [ItemKind | null];
  buffer: ItemKind | null;
};

type InserterState = Record<string, unknown> & {
  tickPhase: number;
  holding: ItemKind | null;
  state: 0 | 1 | 2 | 3;
  skipDropAtTick?: number;
};

type BeltTransferPlan = {
  source: EntityBase;
  target: EntityBase;
  item: ItemKind;
};

type BeltTransferResolution = {
  state: "resolving" | "movable" | "blocked";
  target?: EntityBase | null;
};

type AcceptItemHost = {
  canAcceptItem?: (item: string) => boolean;
  acceptItem: (item: string) => boolean;
};

type ProvideItemHost = {
  canProvideItem?: (item: string) => boolean;
  provideItem: (item: string) => string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const isItemKind = (value: unknown): value is ItemKind => {
  return value === "iron-ore" || value === "iron-plate";
};

const asNonNegativeInteger = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.floor(value);
};

const isAcceptItemHost = (value: unknown): value is AcceptItemHost => {
  return (
    isRecord(value) &&
    typeof value.acceptItem === "function" &&
    (value.canAcceptItem === undefined || typeof value.canAcceptItem === "function")
  );
};

const isProvideItemHost = (value: unknown): value is ProvideItemHost => {
  return (
    isRecord(value) &&
    typeof value.provideItem === "function" &&
    (value.canProvideItem === undefined || typeof value.canProvideItem === "function")
  );
};

const move = (pos: GridCoord, dir: Direction): GridCoord => {
  const delta = DIRECTION_VECTORS[dir];
  return { x: pos.x + delta.x, y: pos.y + delta.y };
};

const opposite = (dir: Direction): Direction => {
  return OPPOSITE_DIRECTION[dir];
};

const directionFromTo = (from: GridCoord, to: GridCoord): Direction | undefined => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 1 && dy === 0) return "E";
  if (dx === -1 && dy === 0) return "W";
  if (dx === 0 && dy === 1) return "S";
  if (dx === 0 && dy === -1) return "N";
  return undefined;
};

const getEntitiesAt = (sim: SimLike, pos: GridCoord): EntityBase[] => {
  const getAt =
    typeof sim.getLiveEntitiesAt === "function" ? sim.getLiveEntitiesAt : sim.getEntitiesAt;

  if (typeof getAt !== "function") {
    return [];
  }

  const entities = getAt(pos);
  if (!Array.isArray(entities)) {
    return [];
  }

  return sortByGridEntityOrder(entities);
};

const ensureMinerState = (entity: EntityBase): MinerState => {
  if (!isRecord(entity.state)) {
    entity.state = {
      tickPhase: 0,
      hasOutput: false,
      output: null,
      light: "on",
    } as MinerState;
  }

  const state = entity.state as MinerState;
  state.tickPhase = asNonNegativeInteger(state.tickPhase);
  state.hasOutput = state.hasOutput === true;
  state.output = isItemKind(state.output) ? state.output : null;
  state.light = "on";

  return state;
};

const syncBeltItemViews = (state: BeltState): void => {
  state.buffer = state.item;
  state.items = [state.item];
};

const ensureBeltState = (entity: EntityBase): BeltState => {
  if (!isRecord(entity.state)) {
    entity.state = {
      tickPhase: 0,
      item: null,
      items: [null],
      buffer: null,
    } as BeltState;
  }

  const state = entity.state as BeltState;
  const compatibleItem = isItemKind(state.item)
    ? state.item
    : isItemKind(state.buffer)
      ? state.buffer
      : null;

  state.tickPhase = asNonNegativeInteger(state.tickPhase);
  state.item = compatibleItem;
  syncBeltItemViews(state);

  return state;
};

const ensureInserterState = (entity: EntityBase): InserterState => {
  if (!isRecord(entity.state)) {
    entity.state = {
      tickPhase: 0,
      holding: null,
      state: 0,
    } as InserterState;
  }

  const state = entity.state as InserterState;
  state.tickPhase = asNonNegativeInteger(state.tickPhase);
  state.holding = isItemKind(state.holding) ? state.holding : null;

  const phase = typeof state.state === "number" ? Math.floor(state.state) : 0;
  state.state = phase === 1 || phase === 2 || phase === 3 ? phase : 0;

  return state;
};

const tryAcceptViaMethod = (host: unknown, item: ItemKind): boolean => {
  if (!isAcceptItemHost(host)) {
    return false;
  }

  if (host.canAcceptItem !== undefined && !host.canAcceptItem(item)) {
    return false;
  }

  return host.acceptItem(item);
};

const canAcceptViaMethod = (host: unknown, item: ItemKind): boolean => {
  if (!isAcceptItemHost(host)) {
    return false;
  }

  if (host.canAcceptItem === undefined) {
    return true;
  }

  return host.canAcceptItem(item);
};

const tryProvideViaMethod = (host: unknown): ItemKind | null => {
  if (!isProvideItemHost(host)) {
    return null;
  }

  const ordered: readonly ItemKind[] = ["iron-plate", "iron-ore"];
  for (const item of ordered) {
    if (host.canProvideItem !== undefined && !host.canProvideItem(item)) {
      continue;
    }

    const provided = host.provideItem(item);
    if (isItemKind(provided)) {
      return provided;
    }
  }

  return null;
};

const isInsertDirectionValid = (source: EntityBase, target: EntityBase): boolean => {
  const incomingDir = directionFromTo(source.pos, target.pos);
  return incomingDir !== undefined && incomingDir === target.rot;
};

const canAcceptDirectly = (
  source: EntityBase,
  target: EntityBase,
  item: ItemKind,
): boolean => {
  if (target.kind === "belt") {
    const beltState = ensureBeltState(target);
    return beltState.item === null;
  }

  if (target.kind === "inserter") {
    const inserterState = ensureInserterState(target);
    return isInsertDirectionValid(source, target) && inserterState.holding === null;
  }

  if (canAcceptViaMethod(target.state, item) || canAcceptViaMethod(target, item)) {
    return true;
  }

  if (target.kind !== "furnace" || !isRecord(target.state)) {
    return false;
  }

  if (item !== "iron-ore") {
    return false;
  }

  const input = target.state.input;
  const inputOccupied = target.state.inputOccupied;
  return (input === null || input === undefined) && inputOccupied !== true;
};

const resolveDirectTransportTarget = (
  sim: SimLike,
  source: EntityBase,
  item: ItemKind,
  targetPos: GridCoord,
): EntityBase | null => {
  const candidates = getEntitiesAt(sim, targetPos);
  for (const candidate of candidates) {
    if (candidate.id === source.id) {
      continue;
    }
    if (canAcceptDirectly(source, candidate, item)) {
      return candidate;
    }
  }

  return null;
};

const tryAcceptItem = (
  target: EntityBase,
  item: ItemKind,
  source: EntityBase,
  sourceTick?: number,
): boolean => {
  if (target.kind === "belt") {
    const beltState = ensureBeltState(target);
    if (beltState.item !== null) {
      return false;
    }
    beltState.item = item;
    syncBeltItemViews(beltState);
    return true;
  }

  if (target.kind === "inserter") {
    const inserterState = ensureInserterState(target);
    if (!isInsertDirectionValid(source, target) || inserterState.holding !== null) {
      return false;
    }

    if (source.kind === "belt" && sourceTick !== undefined) {
      inserterState.skipDropAtTick = sourceTick;
    }

    inserterState.holding = item;
    inserterState.state = 1;
    return true;
  }

  if (tryAcceptViaMethod(target.state, item) || tryAcceptViaMethod(target, item)) {
    return true;
  }

  if (target.kind !== "furnace" || !isRecord(target.state)) {
    return false;
  }

  if (item !== "iron-ore") {
    return false;
  }

  const input = target.state.input;
  const inputOccupied = target.state.inputOccupied;
  const canAccept = (input === null || input === undefined) && inputOccupied !== true;
  if (!canAccept) {
    return false;
  }

  target.state.input = item;
  target.state.inputOccupied = true;
  return true;
};

const tryTakeItem = (source: EntityBase): ItemKind | null => {
  if (source.kind === "belt") {
    const beltState = ensureBeltState(source);
    if (beltState.item === null) {
      return null;
    }
    const item = beltState.item;
    beltState.item = null;
    syncBeltItemViews(beltState);
    return item;
  }

  const providedByMethod = tryProvideViaMethod(source.state) ?? tryProvideViaMethod(source);
  if (providedByMethod !== null) {
    return providedByMethod;
  }

  if (source.kind !== "furnace" || !isRecord(source.state)) {
    return null;
  }

  const output = source.state.output;
  if (!isItemKind(output)) {
    return null;
  }

  source.state.output = null;
  source.state.outputOccupied = false;
  return output;
};

const transferToCell = (
  sim: SimLike,
  from: EntityBase,
  targetPos: GridCoord,
  item: ItemKind,
): boolean => {
  const sourceTick = compareSimTick(sim);
  const candidates = getEntitiesAt(sim, targetPos);
  for (const candidate of candidates) {
    if (candidate.id === from.id) {
      continue;
    }
    if (tryAcceptItem(candidate, item, from, sourceTick)) {
      return true;
    }
  }

  return false;
};

const canTransferToBeltTarget = (
  sim: SimLike,
  source: EntityBase,
  target: EntityBase,
  item: ItemKind,
  reservedTargetIds: Set<string>,
  resolutions: Map<string, BeltTransferResolution>,
): boolean => {
  if (target.id === source.id || reservedTargetIds.has(target.id)) {
    return false;
  }

  if (target.kind === "belt") {
    const targetState = ensureBeltState(target);
    if (targetState.item !== null) {
      return false;
    }

    return true;
  }

  return canAcceptDirectly(source, target, item);
};

const chooseBeltTransferTarget = (
  sim: SimLike,
  source: EntityBase,
  reservedTargetIds: Set<string>,
  resolutions: Map<string, BeltTransferResolution>,
): EntityBase | null => {
  const sourceState = ensureBeltState(source);
  if (sourceState.item === null || sourceState.tickPhase % BELT_TRANSFER_CADENCE_TICKS !== 0) {
    return null;
  }

  const existingResolution = resolutions.get(source.id);
  if (existingResolution !== undefined) {
    if (existingResolution.state === "resolving") {
      return null;
    }
    return existingResolution.state === "movable" ? existingResolution.target ?? null : null;
  }

  const targetPos = move(source.pos, source.rot);
  const candidates = getEntitiesAt(sim, targetPos);
  resolutions.set(source.id, { state: "resolving", target: null });

  for (const candidate of candidates) {
    if (candidate.id === source.id) {
      continue;
    }

    if (!canTransferToBeltTarget(sim, source, candidate, sourceState.item, reservedTargetIds, resolutions)) {
      continue;
    }

    reservedTargetIds.add(candidate.id);
    resolutions.set(source.id, { state: "movable", target: candidate });
    return candidate;
  }

  resolutions.set(source.id, { state: "blocked", target: null });
  return null;
};

const buildBeltTransferPlans = (
  sim: SimLike,
  entities: ReadonlyArray<EntityBase>,
  reservedTargetIds: Set<string>,
): BeltTransferPlan[] => {
  const plans: BeltTransferPlan[] = [];
  const resolutions = new Map<string, BeltTransferResolution>();

  for (const source of entities) {
    const sourceState = ensureBeltState(source);
    sourceState.tickPhase += 1;
  }

  for (const source of entities) {
    const sourceState = ensureBeltState(source);
    if (sourceState.item === null || sourceState.tickPhase % BELT_TRANSFER_CADENCE_TICKS !== 0) {
      continue;
    }

    const target = chooseBeltTransferTarget(sim, source, reservedTargetIds, resolutions);
    if (target === null) {
      continue;
    }

    plans.push({
      source,
      target,
      item: sourceState.item,
    });
  }

  return plans;
};

const commitBeltTransferPlans = (
  sim: SimLike,
  plans: ReadonlyArray<BeltTransferPlan>,
): void => {
  for (const plan of plans) {
    const sourceState = ensureBeltState(plan.source);
    if (sourceState.item !== plan.item) {
      continue;
    }

    sourceState.item = null;
    syncBeltItemViews(sourceState);
  }

  for (const plan of plans) {
    if (tryAcceptItem(plan.target, plan.item, plan.source, compareSimTick(sim))) {
      continue;
    }

    const sourceState = ensureBeltState(plan.source);
    sourceState.item = plan.item;
    syncBeltItemViews(sourceState);
  }
};

const canMineTile = (sim: SimLike, pos: GridCoord): boolean => {
  const fromGetter = typeof sim.getMap === "function" ? sim.getMap() : undefined;
  const map = fromGetter ?? sim.map;
  if (map === undefined || typeof map.isOre !== "function") {
    return true;
  }

  return map.isOre(pos.x, pos.y);
};

const tickMinerEntity = (entity: EntityBase, _dtMs: number, sim: SimLike): void => {
  const state = ensureMinerState(entity);
  state.tickPhase += 1;

  if (state.tickPhase % MINER_CADENCE_TICKS !== 0) {
    state.hasOutput = false;
    state.output = null;
    return;
  }

  if (!canMineTile(sim, entity.pos)) {
    state.hasOutput = false;
    state.output = null;
    return;
  }

  const emitted = transferToCell(sim, entity, move(entity.pos, entity.rot), "iron-ore");
  state.hasOutput = emitted;
  state.output = emitted ? "iron-ore" : null;
};

const collectInserterDropReservations = (
  sim: SimLike,
  inserters: ReadonlyArray<EntityBase>,
): Set<string> => {
  const reserved = new Set<string>();
  for (const inserter of inserters) {
    const state = ensureInserterState(inserter);
    if (state.holding === null) {
      continue;
    }

    const target = resolveDirectTransportTarget(
      sim,
      inserter,
      state.holding,
      move(inserter.pos, inserter.rot),
    );
    if (target === null) {
      continue;
    }

    reserved.add(target.id);
  }

  return reserved;
};

const tickBeltEntities = (
  entities: ReadonlyArray<EntityBase>,
  sim: SimLike,
  reservedTargetIds: Set<string>,
): void => {
  const plans = buildBeltTransferPlans(sim, entities, new Set(reservedTargetIds));
  if (plans.length === 0) {
    return;
  }

  commitBeltTransferPlans(sim, plans);
};

const tickInserterEntity = (entity: EntityBase, _dtMs: number, sim: SimLike): void => {
  const state = ensureInserterState(entity);
  state.tickPhase += 1;

  if (state.tickPhase % INSERTER_CADENCE_TICKS !== 0) {
    return;
  }

  const pickupPos = move(entity.pos, opposite(entity.rot));
  const dropPos = move(entity.pos, entity.rot);

  if (state.holding !== null) {
    if (state.skipDropAtTick !== undefined) {
      const currentTick = compareSimTick(sim);
      if (state.skipDropAtTick === currentTick) {
        state.skipDropAtTick = undefined;
        return;
      }

      if (state.skipDropAtTick < currentTick) {
        state.skipDropAtTick = undefined;
      }
    }

    if (transferToCell(sim, entity, dropPos, state.holding)) {
      state.holding = null;
      state.state = 3;
    } else {
      state.state = 2;
    }
    return;
  }

  const sources = getEntitiesAt(sim, pickupPos);
  for (const source of sources) {
    if (source.id === entity.id) {
      continue;
    }
    const item = tryTakeItem(source);
    if (item === null) {
      continue;
    }
    state.holding = item;
    state.state = 1;
    return;
  }

  state.state = 0;
};

const tickFurnaceEntity = (entity: EntityBase, dtMs: number): void => {
  if (!isRecord(entity.state)) {
    return;
  }

  const furnaceState = entity.state as { update: unknown };
  if (typeof furnaceState.update !== "function") {
    return;
  }

  furnaceState.update(dtMs);
};

const runCanonicalTick = (sim: SimLike, dtMs: number): void => {
  const grouped = canonicalEntitiesByKind(sim);
  const orderedKinds = CANONICAL_TICK_PHASES;
  const inserterDropReservations = collectInserterDropReservations(sim, grouped.inserter);

  for (const kind of orderedKinds) {
    const entities = grouped[kind];
    if (kind === "miner") {
      for (const entity of entities) {
        tickMinerEntity(entity, dtMs, sim);
      }
      continue;
    }

    if (kind === "belt") {
      tickBeltEntities(entities, sim, inserterDropReservations);
      continue;
    }

    if (kind === "inserter") {
      for (const entity of entities) {
        tickInserterEntity(entity, dtMs, sim);
      }
      continue;
    }

    for (const entity of entities) {
      tickFurnaceEntity(entity, dtMs);
    }
  }
};

const runCanonicalPhasesIfNeeded = (dtMs: number, sim: SimLike): void => {
  const state = getTickState(sim);
  const tick = compareSimTick(sim);
  if (state.runningTick === tick && !state.inProgress) {
    return;
  }

  if (state.inProgress) {
    return;
  }

  state.inProgress = true;
  state.runningTick = tick;

  try {
    runCanonicalTick(sim, dtMs);
  } finally {
    state.inProgress = false;
  }
};

const registerMiner = (): void => {
  if (getDefinition("miner") !== undefined) {
    return;
  }

  registerEntity("miner", {
    create: () => ({
      tickPhase: 0,
      hasOutput: false,
      output: null,
      light: "on",
    }),
    tickPhase: "miner",
    update: (_entity, dtMs, sim) => runCanonicalPhasesIfNeeded(dtMs, sim as SimLike),
  });
};

const registerBelt = (): void => {
  if (getDefinition("belt") !== undefined) {
    return;
  }

  registerEntity("belt", {
    create: () => ({
      tickPhase: 0,
      item: null,
      items: [null],
      buffer: null,
    }),
    tickPhase: "belt",
    update: (_entity, dtMs, sim) => runCanonicalPhasesIfNeeded(dtMs, sim as SimLike),
  });
};

const registerInserter = (): void => {
  if (getDefinition("inserter") !== undefined) {
    return;
  }

  registerEntity("inserter", {
    create: () => ({
      tickPhase: 0,
      holding: null,
      state: 0,
    }),
    tickPhase: "inserter",
    update: (_entity, dtMs, sim) => runCanonicalPhasesIfNeeded(dtMs, sim as SimLike),
  });
};

const registerFurnace = (): void => {
  if (getDefinition(FURNACE_TYPE) !== undefined) {
    return;
  }

  registerEntity(FURNACE_TYPE, {
    create: () => new Furnace(),
    tickPhase: "furnace",
    update: (_entity, dtMs, sim) => runCanonicalPhasesIfNeeded(dtMs, sim as SimLike),
  });
};

const registerDefaults = (): void => {
  registerMiner();
  registerBelt();
  registerInserter();
  registerFurnace();
};

registerDefaults();

export const MINER_ATTEMPT_TICKS = 60;
export const BELT_ATTEMPT_TICKS = 15;
export const INSERTER_ATTEMPT_TICKS = 20;

const isBoundaryTick = (tick: number, interval: number): boolean => {
  if (interval <= 0 || !Number.isInteger(interval)) {
    return false;
  }

  if (!Number.isInteger(tick) || tick <= 0) {
    return false;
  }

  return tick % interval === 0;
};

export const hasElapsedBoundaryTick = (tick: number, interval: 15 | 20 | 60): boolean => {
  return isBoundaryTick(tick, interval);
};

export const entities: Record<string, { create: () => Furnace }> = {
  [FURNACE_TYPE]: { create: () => new Furnace() },
};

export const isRegistered = (type: string): boolean => Object.hasOwn(entities, type);
