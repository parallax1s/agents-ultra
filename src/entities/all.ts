import { getDefinition, registerEntity } from "../core/registry";
import type { Direction, EntityBase, GridCoord, ItemKind } from "../core/types";
import { Furnace, FURNACE_TYPE } from "./furnace";

const MINER_CADENCE_TICKS = 60;
const BELT_TRANSFER_CADENCE_TICKS = 15;
const INSERTER_CADENCE_TICKS = 20;

const DIR_VECTORS: Readonly<Record<Direction, GridCoord>> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

type SimLike = {
  readonly getEntitiesAt?: (pos: GridCoord) => EntityBase[];
  readonly map?: {
    readonly isOre?: (x: number, y: number) => boolean;
  };
  readonly getMap?: () => {
    readonly isOre?: (x: number, y: number) => boolean;
  };
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
  const delta = DIR_VECTORS[dir];
  return { x: pos.x + delta.x, y: pos.y + delta.y };
};

const opposite = (dir: Direction): Direction => {
  if (dir === "N") return "S";
  if (dir === "S") return "N";
  if (dir === "E") return "W";
  return "E";
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
  if (typeof sim.getEntitiesAt !== "function") {
    return [];
  }

  const entities = sim.getEntitiesAt(pos);
  return Array.isArray(entities) ? entities : [];
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

const tryAcceptItem = (
  target: EntityBase,
  item: ItemKind,
  sourcePos: GridCoord,
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
    const incomingDir = directionFromTo(sourcePos, target.pos);
    if (incomingDir !== target.rot || inserterState.holding !== null) {
      return false;
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
  const candidates = getEntitiesAt(sim, targetPos);
  for (const candidate of candidates) {
    if (candidate.id === from.id) {
      continue;
    }
    if (tryAcceptItem(candidate, item, from.pos)) {
      return true;
    }
  }

  return false;
};

const canMineTile = (sim: SimLike, pos: GridCoord): boolean => {
  const fromGetter = typeof sim.getMap === "function" ? sim.getMap() : undefined;
  const map = fromGetter ?? sim.map;
  if (map === undefined || typeof map.isOre !== "function") {
    return true;
  }

  return map.isOre(pos.x, pos.y);
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
    update: (entity, _dtMs, sim) => {
      const state = ensureMinerState(entity);
      state.tickPhase += 1;

      if (state.tickPhase % MINER_CADENCE_TICKS !== 0) {
        state.hasOutput = false;
        state.output = null;
        return;
      }

      if (!canMineTile(sim as SimLike, entity.pos)) {
        state.hasOutput = false;
        state.output = null;
        return;
      }

      const emitted = transferToCell(
        sim as SimLike,
        entity,
        move(entity.pos, entity.rot),
        "iron-ore",
      );

      state.hasOutput = emitted;
      state.output = emitted ? "iron-ore" : null;
    },
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
    update: (entity, _dtMs, sim) => {
      const state = ensureBeltState(entity);
      state.tickPhase += 1;

      if (state.item === null || state.tickPhase % BELT_TRANSFER_CADENCE_TICKS !== 0) {
        return;
      }

      const targetPos = move(entity.pos, entity.rot);
      const transferred = transferToCell(sim as SimLike, entity, targetPos, state.item);
      if (!transferred) {
        return;
      }

      state.item = null;
      syncBeltItemViews(state);
    },
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
    update: (entity, _dtMs, sim) => {
      const state = ensureInserterState(entity);
      state.tickPhase += 1;

      if (state.tickPhase % INSERTER_CADENCE_TICKS !== 0) {
        return;
      }

      const simRef = sim as SimLike;
      const pickupPos = move(entity.pos, opposite(entity.rot));
      const dropPos = move(entity.pos, entity.rot);

      if (state.holding !== null) {
        if (transferToCell(simRef, entity, dropPos, state.holding)) {
          state.holding = null;
          state.state = 3;
        } else {
          state.state = 2;
        }
        return;
      }

      const sources = getEntitiesAt(simRef, pickupPos);
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
    },
  });
};

const registerDefaults = (): void => {
  registerMiner();
  registerBelt();
  registerInserter();
};

registerDefaults();

export const entities: Record<string, { create: () => Furnace }> = {
  [FURNACE_TYPE]: { create: () => new Furnace() },
};

export const isRegistered = (type: string): boolean => type in entities;
