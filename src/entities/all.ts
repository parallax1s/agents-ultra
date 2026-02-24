import {
  CANONICAL_TICK_PHASES,
  CANONICAL_TICK_PHASE_CADENCE_TICKS,
  registerEntity,
  getDefinition,
} from "../core/registry";
import { sortByGridEntityOrder } from "../core/map";
import {
  DIRECTION_VECTORS,
  FURNACE_INPUT_ITEM,
  OPPOSITE_DIRECTION,
  rotateDirection,
} from "../core/types";
import type { Direction, EntityBase, GridCoord, ItemKind } from "../core/types";
import { Furnace, FURNACE_TYPE, type FurnacePowerHooks } from "./furnace";
import { Assembler, ASSEMBLER_TYPE, type AssemblerPowerHooks } from "./assembler";

const getCanonicalCadenceTicks = (kind: CanonicalTickKind): number =>
  CANONICAL_TICK_PHASE_CADENCE_TICKS[kind];

const POWER_COSTS = {
  miner: 2,
  beltTransfer: 1,
  inserterMove: 1,
  inserterPickup: 1,
  furnaceStart: 2,
  furnaceTick: 1,
  furnaceFuelToPower: 182,
  assemblerStart: 2,
  assemblerTick: 1,
};

type CanonicalTickKind = "miner" | "belt" | "inserter" | "furnace";

type SimLike = {
  readonly getEntitiesAt?: (pos: GridCoord) => EntityBase[];
  readonly getLiveEntitiesAt?: (pos: GridCoord) => EntityBase[];
  readonly getAllEntities?: () => EntityBase[];
  readonly getLiveAllEntities?: () => EntityBase[];
  readonly tick?: number;
  readonly tickCount?: number;
  readonly consumePower?: (amount: number, kind?: string, consumerId?: string) => boolean;
  readonly generatePower?: (amount: number, kind?: string) => number;
  readonly getPowerState?: () => unknown;
  readonly isPowerConsumerConnected?: (consumerId: string) => boolean;
  readonly map?: {
    readonly isOre?: (x: number, y: number) => boolean;
    readonly isTree?: (x: number, y: number) => boolean;
    readonly consumeResource?: (x: number, y: number) => boolean;
    readonly getTile?: (x: number, y: number) => unknown;
  };
  readonly getMap?: () => {
    readonly isOre?: (x: number, y: number) => boolean;
    readonly isTree?: (x: number, y: number) => boolean;
    readonly consumeResource?: (x: number, y: number) => boolean;
    readonly getTile?: (x: number, y: number) => unknown;
  };
};

type TickPhaseState = {
  runningTick: number | null;
  inProgress: boolean;
};

const tickState = new WeakMap<object, TickPhaseState>();
const canonicalPhaseKinds: ReadonlyArray<CanonicalTickKind> = CANONICAL_TICK_PHASES;

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

const tryConsumePower = (
  sim: SimLike,
  amount: number,
  kind = "unknown",
  consumer: EntityBase | null = null,
): boolean => {
  if (typeof sim.consumePower !== "function") {
    return true;
  }

  if (consumer !== null) {
    return sim.consumePower(amount, kind, consumer.id);
  }

  return sim.consumePower(amount, kind);
};

const tryGeneratePower = (sim: SimLike, amount: number, kind?: string): number => {
  if (typeof sim.generatePower !== "function") {
    return 0;
  }

  return sim.generatePower(amount, kind);
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
    if (entity.kind === "splitter") {
      grouped.belt.push(entity);
      continue;
    }

    if (entity.kind === ASSEMBLER_TYPE) {
      grouped.furnace.push(entity);
      continue;
    }

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
  justMined: boolean;
  light: "on";
};

type BeltState = Record<string, unknown> & {
  tickPhase: number;
  item: ItemKind | null;
  items: [ItemKind | null];
  buffer: ItemKind | null;
  accept: ItemKind | null;
};

type SplitterState = BeltState & {
  nextOutputIndex: 0 | 1;
};

type InserterState = Record<string, unknown> & {
  tickPhase: number;
  holding: ItemKind | null;
  state: 0 | 1 | 2 | 3;
  skipDropAtTick?: number;
};

type ChestState = Record<string, unknown> & {
  capacity: number;
  items: ItemKind[];
  stored: Record<ItemKind, number>;
  canAcceptItem: (item: string) => boolean;
  acceptItem: (item: string) => boolean;
  canProvideItem: (item: string) => boolean;
  provideItem: (item: string) => string | null;
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
  return (
    value === "iron-ore" ||
    value === "iron-plate" ||
    value === "coal" ||
    value === "iron-gear" ||
    value === "wood"
  );
};

const CHEST_DEFAULT_CAPACITY = 24;

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
      justMined: false,
      light: "on",
    } as MinerState;
  }

  const state = entity.state as MinerState;
  state.tickPhase = asNonNegativeInteger(state.tickPhase);
  state.hasOutput = state.hasOutput === true;
  state.output = isItemKind(state.output) ? state.output : null;
  state.justMined = state.justMined === true;
  state.light = "on";

  if (state.output === null) {
    state.justMined = false;
  }

  return state;
};

const tryMoveMinerOutput = (
  entity: EntityBase,
  sim: SimLike,
  minedItem: ItemKind,
): boolean => {
  const minePos = findMinerOutputTarget(sim, entity, minedItem);
  if (minePos === null) {
    return false;
  }

  return transferToCell(sim, entity, minePos, minedItem);
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
      accept: null,
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
  state.accept = isItemKind(state.accept) ? state.accept : null;
  syncBeltItemViews(state);

  return state;
};

const canBeltAcceptItem = (state: BeltState, item: ItemKind): boolean => {
  return state.accept === null || state.accept === item;
};

const ensureSplitterState = (entity: EntityBase): SplitterState => {
  const state = ensureBeltState(entity) as SplitterState;
  state.nextOutputIndex = state.nextOutputIndex === 1 ? 1 : 0;
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

const createChestState = (capacity = CHEST_DEFAULT_CAPACITY): ChestState => {
  const normalizedCapacity =
    Number.isInteger(capacity) && capacity > 0 ? capacity : CHEST_DEFAULT_CAPACITY;
  const state: ChestState = {
    capacity: normalizedCapacity,
    items: [],
    stored: {
      "iron-ore": 0,
      "iron-plate": 0,
      "iron-gear": 0,
      coal: 0,
      wood: 0,
    },
    canAcceptItem(item: string): boolean {
      return isItemKind(item) && state.items.length < state.capacity;
    },
    acceptItem(item: string): boolean {
      if (!state.canAcceptItem(item)) {
        return false;
      }
      if (!isItemKind(item)) {
        return false;
      }

      state.items.push(item);
      state.stored[item] = Math.max(0, state.stored[item] + 1);
      return true;
    },
    canProvideItem(item: string): boolean {
      return isItemKind(item) && state.stored[item] > 0;
    },
    provideItem(item: string): string | null {
      if (!state.canProvideItem(item) || !isItemKind(item)) {
        return null;
      }

      const slotIndex = state.items.findIndex((entry) => entry === item);
      if (slotIndex < 0) {
        return null;
      }

      state.items.splice(slotIndex, 1);
      state.stored[item] = Math.max(0, state.stored[item] - 1);
      return item;
    },
  };

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

  const ordered: readonly ItemKind[] = ["iron-plate", "iron-gear", "coal", "wood", "iron-ore"];
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

const isSplitterInputDirectionValid = (source: EntityBase, target: EntityBase): boolean => {
  return isInsertDirectionValid(source, target);
};

const canAcceptDirectly = (
  source: EntityBase,
  target: EntityBase,
  item: ItemKind,
): boolean => {
  if (target.kind === "belt") {
    const beltState = ensureBeltState(target);
    return beltState.item === null && canBeltAcceptItem(beltState, item);
  }

  if (target.kind === "splitter") {
    const splitterState = ensureSplitterState(target);
    return splitterState.item === null && isSplitterInputDirectionValid(source, target);
  }

  if (target.kind === "inserter") {
    const inserterState = ensureInserterState(target);
    return isInsertDirectionValid(source, target) && inserterState.holding === null;
  }

  if (canAcceptViaMethod(target.state, item) || canAcceptViaMethod(target, item)) {
    return true;
  }
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
    if (beltState.item !== null || !canBeltAcceptItem(beltState, item)) {
      return false;
    }
    beltState.item = item;
    syncBeltItemViews(beltState);
    return true;
  }

  if (target.kind === "splitter") {
    const splitterState = ensureSplitterState(target);
    if (splitterState.item !== null) {
      return false;
    }

    splitterState.item = item;
    syncBeltItemViews(splitterState);
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

  if (source.kind === "splitter") {
    const splitterState = ensureSplitterState(source);
    if (splitterState.item === null) {
      return null;
    }
    const item = splitterState.item;
    splitterState.item = null;
    syncBeltItemViews(splitterState);
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

const canTransferToCell = (
  sim: SimLike,
  from: EntityBase,
  targetPos: GridCoord,
  item: ItemKind,
): boolean => {
  const candidates = getEntitiesAt(sim, targetPos);
  for (const candidate of candidates) {
    if (candidate.id === from.id) {
      continue;
    }
    if (canAcceptDirectly(from, candidate, item)) {
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

    if (!canBeltAcceptItem(targetState, item)) {
      return false;
    }

    return true;
  }

  return canAcceptDirectly(source, target, item);
};

const getSplitterOutputTargets = (source: EntityBase): Array<{ direction: Direction; pos: GridCoord }> => {
  if (source.kind !== "splitter") {
    return [];
  }

  return [
    { direction: rotateDirection(source.rot, -1), pos: move(source.pos, rotateDirection(source.rot, -1)) },
    { direction: rotateDirection(source.rot, 1), pos: move(source.pos, rotateDirection(source.rot, 1)) },
  ];
};

const chooseBeltTransferTarget = (
  sim: SimLike,
  source: EntityBase,
  reservedTargetIds: Set<string>,
  resolutions: Map<string, BeltTransferResolution>,
): EntityBase | null => {
  const sourceState = source.kind === "splitter" ? ensureSplitterState(source) : ensureBeltState(source);
  if (sourceState.item === null || sourceState.tickPhase % getCanonicalCadenceTicks("belt") !== 0) {
    return null;
  }

  const existingResolution = resolutions.get(source.id);
  if (existingResolution !== undefined) {
    if (existingResolution.state === "resolving") {
      return null;
    }
    return existingResolution.state === "movable" ? existingResolution.target ?? null : null;
  }

  const candidateTargetPositions = source.kind === "splitter"
    ? getSplitterOutputTargets(source)
    : [{ direction: source.rot, pos: move(source.pos, source.rot) }];

  if (source.kind === "splitter") {
    const splitterState = sourceState as SplitterState;
    for (let index = 0; index < candidateTargetPositions.length; index += 1) {
      const candidate = candidateTargetPositions[(splitterState.nextOutputIndex + index) % candidateTargetPositions.length];
      const candidateEntities = getEntitiesAt(sim, candidate.pos);
      for (const target of candidateEntities) {
        if (target.id === source.id) {
          continue;
        }

        if (!canTransferToBeltTarget(sim, source, target, sourceState.item, reservedTargetIds, resolutions)) {
          continue;
        }

        splitterState.nextOutputIndex = splitterState.nextOutputIndex === 0 ? 1 : 0;
        reservedTargetIds.add(target.id);
        resolutions.set(source.id, { state: "movable", target });
        return target;
      }
    }

    resolutions.set(source.id, { state: "blocked", target: null });
    return null;
  }

  const targetPos = candidateTargetPositions[0].pos;
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
    if (sourceState.item === null || sourceState.tickPhase % getCanonicalCadenceTicks("belt") !== 0) {
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
    if (!tryConsumePower(sim, POWER_COSTS.beltTransfer, "belt-transfer", plan.source)) {
      continue;
    }

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

const resolveMinedItemFromMap = (
  sim: SimLike,
  pos: GridCoord,
): ItemKind | null => {
  const map = typeof sim.getMap === "function" ? sim.getMap() : sim.map;
  if (map === undefined) {
    return FURNACE_INPUT_ITEM;
  }

  if (typeof map.getTile === "function") {
    const tile = map.getTile(pos.x, pos.y);
    if (tile === "coal-ore") {
      return "coal";
    }

    if (tile === "iron-ore") {
      return FURNACE_INPUT_ITEM;
    }

    if (tile === "tree") {
      return "wood";
    }
  }

  if (typeof map.isCoal === "function" && map.isCoal(pos.x, pos.y)) {
    return "coal";
  }

  if (typeof map.isOre === "function" && map.isOre(pos.x, pos.y)) {
    return FURNACE_INPUT_ITEM;
  }

  if (typeof map.isTree === "function" && map.isTree(pos.x, pos.y)) {
    return "wood";
  }

  if (typeof map.isOre !== "function" && typeof map.isCoal !== "function") {
    return FURNACE_INPUT_ITEM;
  }

  return null;
};

const consumeMinedResourceFromMap = (
  sim: SimLike,
  pos: GridCoord,
): boolean => {
  const map = typeof sim.getMap === "function" ? sim.getMap() : sim.map;
  if (map === undefined || map === null) {
    return true;
  }

  const consumeResource = map.consumeResource;
  if (typeof consumeResource !== "function") {
    return true;
  }

  return consumeResource(pos.x, pos.y);
};

const canMineTile = (sim: SimLike, pos: GridCoord): boolean => {
  return resolveMinedItemFromMap(sim, pos) !== null;
};

const MINER_FALLBACK_OUTPUT_DIRECTIONS: ReadonlyArray<Direction> = [
  "N",
  "E",
  "S",
  "W",
];

const getMinedItemFromTile = (sim: SimLike, pos: GridCoord): ItemKind => {
  const resolved = resolveMinedItemFromMap(sim, pos);
  if (resolved === null) {
    return FURNACE_INPUT_ITEM;
  }

  return resolved;
};

const findMinerOutputTarget = (
  sim: SimLike,
  entity: EntityBase,
  minedItem: ItemKind,
): GridCoord | null => {
  const preferred = move(entity.pos, entity.rot);
  if (canTransferToCell(sim, entity, preferred, minedItem)) {
    return preferred;
  }

  for (const direction of MINER_FALLBACK_OUTPUT_DIRECTIONS) {
    if (direction === entity.rot) {
      continue;
    }

    const candidate = move(entity.pos, direction);
    if (canTransferToCell(sim, entity, candidate, minedItem)) {
      return candidate;
    }
  }

  return null;
};

const tickMinerEntity = (entity: EntityBase, _dtMs: number, sim: SimLike): void => {
  const state = ensureMinerState(entity);
  state.tickPhase += 1;
  state.justMined = false;

  if (state.output !== null && state.output !== undefined) {
    if (!state.hasOutput) {
      state.hasOutput = true;
    }
  }

  if (state.output !== null) {
    if (tryMoveMinerOutput(entity, sim, state.output)) {
      state.output = null;
      state.hasOutput = false;
      state.justMined = true;
    } else {
      state.hasOutput = true;
    }
    return;
  }

  if (state.tickPhase % getCanonicalCadenceTicks("miner") !== 0) {
    return;
  }

  if (!canMineTile(sim, entity.pos)) {
    state.hasOutput = false;
    state.output = null;
    return;
  }

  const minedItem = getMinedItemFromTile(sim, entity.pos);
  if (!isItemKind(minedItem)) {
    return;
  }

  const minePos = findMinerOutputTarget(sim, entity, minedItem);
  if (minePos === null) {
    return;
  }

  if (!tryConsumePower(sim, POWER_COSTS.miner, "miner", entity)) {
    return;
  }

  if (!consumeMinedResourceFromMap(sim, entity.pos)) {
    return;
  }

  if (transferToCell(sim, entity, minePos, minedItem)) {
    state.output = null;
    state.hasOutput = false;
    state.justMined = true;
    return;
  }

  state.output = minedItem;
  state.hasOutput = true;
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

  if (state.tickPhase % getCanonicalCadenceTicks("inserter") !== 0) {
    return;
  }

  const pickupPos = move(entity.pos, opposite(entity.rot));
  const dropPos = move(entity.pos, entity.rot);

  if (state.holding !== null) {
    if (!canTransferToCell(sim, entity, dropPos, state.holding)) {
      state.state = 2;
      return;
    }

    if (!tryConsumePower(sim, POWER_COSTS.inserterMove, "inserter-move", entity)) {
      return;
    }

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

    if (!tryConsumePower(sim, POWER_COSTS.inserterPickup, "inserter-pickup", entity)) {
      tryAcceptItem(source, item, entity);
      return;
    }

    state.holding = item;
    state.state = 1;
    return;
  }

  state.state = 0;
};

const tickFurnaceEntity = (entity: EntityBase, dtMs: number, sim: SimLike): void => {
  if (!isRecord(entity.state)) {
    return;
  }

  if (entity.kind === ASSEMBLER_TYPE) {
    const assemblerState = entity.state as {
      update: unknown;
      setPowerHooks?: (hooks: AssemblerPowerHooks) => void;
    };
    if (typeof assemblerState.update !== "function") {
      return;
    }

    const startPower = () =>
      tryConsumePower(sim, POWER_COSTS.assemblerStart, "assembler-start", entity);
    const tickPower = () =>
      tryConsumePower(sim, POWER_COSTS.assemblerTick, "assembler-tick", entity);
    if (typeof assemblerState.setPowerHooks === "function") {
      assemblerState.setPowerHooks({ onStart: startPower, onTick: tickPower });
    }

    assemblerState.update(dtMs, { onStart: startPower, onTick: tickPower });
    return;
  }

  const furnaceState = entity.state as {
    update: unknown;
    setPowerHooks?: (hooks: FurnacePowerHooks) => void;
  };
  if (typeof furnaceState.update !== "function") {
    return;
  }

    const startPower = () => tryConsumePower(sim, POWER_COSTS.furnaceStart, "furnace-start", entity);
    const tickPower = () => tryConsumePower(sim, POWER_COSTS.furnaceTick, "furnace-tick", entity);
  const onFuelBurn = () => {
    tryGeneratePower(sim, POWER_COSTS.furnaceFuelToPower, "furnace-fuel-burn");
  };

  if (typeof furnaceState.setPowerHooks === "function") {
    furnaceState.setPowerHooks({
      onStart: startPower,
      onTick: tickPower,
      onFuelBurn,
    });
  }

  furnaceState.update(dtMs, { onStart: startPower, onTick: tickPower, onFuelBurn });
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
      tickFurnaceEntity(entity, dtMs, sim);
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
      accept: null,
    }),
    tickPhase: "belt",
    update: (_entity, dtMs, sim) => runCanonicalPhasesIfNeeded(dtMs, sim as SimLike),
  });
};

const registerSplitter = (): void => {
  if (getDefinition("splitter") !== undefined) {
    return;
  }

  registerEntity("splitter", {
    create: () => ({
      tickPhase: 0,
      item: null,
      items: [null],
      buffer: null,
      accept: null,
      nextOutputIndex: 0,
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

const registerAssembler = (): void => {
  if (getDefinition(ASSEMBLER_TYPE) !== undefined) {
    return;
  }

  registerEntity(ASSEMBLER_TYPE, {
    create: () => new Assembler(),
    tickPhase: "furnace",
    update: (_entity, dtMs, sim) => runCanonicalPhasesIfNeeded(dtMs, sim as SimLike),
  });
};

const registerChest = (): void => {
  if (getDefinition("chest") !== undefined) {
    return;
  }

  registerEntity("chest", {
    create: () => createChestState(),
    update: () => {
      // Chest state is mutated by inserter/furnace/player interactions.
    },
  });
};

const SOLAR_PANEL_POWER_PER_TICK = 6;
const ACCUMULATOR_POWER_CAPACITY = 120;

const registerSolarPanel = (): void => {
  if (getDefinition("solar-panel") !== undefined) {
    return;
  }

  registerEntity("solar-panel", {
    create: () => ({}),
    update: (_entity, _dtMs, sim) => {
      if (typeof sim.generatePower !== "function") {
        return;
      }
      tryGeneratePower(sim, SOLAR_PANEL_POWER_PER_TICK, "solar-panel");
    },
  });
};

const registerAccumulator = (): void => {
  if (getDefinition("accumulator") !== undefined) {
    return;
  }

  registerEntity("accumulator", {
    create: () => ({
      storageCapacity: ACCUMULATOR_POWER_CAPACITY,
    }),
    update: () => {
      // Accumulator behavior is modeled in the sim power network as additional capacity.
    },
  });
};

const registerDefaults = (): void => {
  registerMiner();
  registerBelt();
  registerSplitter();
  registerInserter();
  registerFurnace();
  registerAssembler();
  registerChest();
  registerSolarPanel();
  registerAccumulator();
};

registerDefaults();

export const MINER_ATTEMPT_TICKS = CANONICAL_TICK_PHASE_CADENCE_TICKS.miner;
export const BELT_ATTEMPT_TICKS = CANONICAL_TICK_PHASE_CADENCE_TICKS.belt;
export const INSERTER_ATTEMPT_TICKS = CANONICAL_TICK_PHASE_CADENCE_TICKS.inserter;

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
