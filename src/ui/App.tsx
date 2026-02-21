/// <reference path="../types/react-shim.d.ts" />
/// <reference path="../types/modules.d.ts" />

import { useCallback, useEffect, useRef, useState } from 'react';

import Palette from './palette';
import {
  ALL_ENTITY_KINDS,
  createPlacementController,
  type CoreActionOutcome,
  type EntityKind,
  type Rotation,
  type Simulation,
} from './placement';
import { createRenderer, preloadRendererSvgs } from './renderer';
import { createMap } from '../core/map';
import { createSim } from '../core/sim';
import '../entities/all';

const TILE_SIZE = 32;
const WORLD_WIDTH = 60;
const WORLD_HEIGHT = 40;
const WORLD_SEED = 'agents-ultra';
const SIM_STEP_MS = 1000 / 60;
const PLAYER_MAX_FUEL = 100;
const PLAYER_MOVE_FUEL_COST = 1;
const PLAYER_BUILD_FUEL_COST = 2;
const PLAYER_REFUEL_AMOUNT = 25;

type Tile = {
  x: number;
  y: number;
};

type RendererApi = {
  setGhost(tile: Tile | null, valid: boolean): void;
  destroy(): void;
  resize?(width: number, height: number): void;
};

type PaletteProps = {
  selectedKind: EntityKind | null;
  onSelectKind(kind: EntityKind): void;
};

type PaletteViewComponent = (props: PaletteProps) => ReturnType<typeof Palette>;

const PaletteView = Palette as unknown as PaletteViewComponent;

const HOTKEY_TO_KIND: Readonly<Record<'Digit1' | 'Digit2' | 'Digit3' | 'Digit4', EntityKind>> = {
  Digit1: 'Miner',
  Digit2: 'Belt',
  Digit3: 'Inserter',
  Digit4: 'Furnace',
};

type RuntimeDirection = 'N' | 'E' | 'S' | 'W';
type RuntimeEntityKind = 'miner' | 'belt' | 'inserter' | 'furnace';

type RuntimeEntity = {
  id: string;
  kind: RuntimeEntityKind;
  pos: Tile;
  rot: RuntimeDirection;
  state?: Record<string, unknown>;
};

type PlacementSnapshot = {
  tick: number;
  tickCount: number;
  elapsedMs: number;
  entityCount: number;
  fuel: number;
  maxFuel: number;
  player: Tile;
};

type RuntimeSimulation = Simulation & {
  width: number;
  height: number;
  tileSize: number;
  tick: number;
  tickCount: number;
  elapsedMs: number;
  isPaused: () => boolean;
  getMap: () => ReturnType<typeof createMap>;
  getAllEntities: () => RuntimeEntity[];
  getPlacementSnapshot: () => PlacementSnapshot;
  getPlayerSnapshot: () => { x: number; y: number; fuel: number; maxFuel: number; rot?: RuntimeDirection };
  movePlayer: (direction: RuntimeDirection) => CoreActionOutcome;
  refuel: () => CoreActionOutcome;
  destroy: () => void;
};

type Feedback = {
  kind: 'success' | 'error';
  message: string;
};

type RuntimeMetrics = {
  entityCount: number;
  miners: number;
  belts: number;
  inserters: number;
  furnaces: number;
  oreInTransit: number;
  platesInTransit: number;
  furnacesCrafting: number;
  furnacesReady: number;
};

type HudState = {
  tool: EntityKind | null;
  rotation: Rotation;
  paused: boolean;
  tick: number;
  fuel: number;
  maxFuel: number;
  player: Tile;
  metrics: RuntimeMetrics;
};

const RUNTIME_KIND: Record<EntityKind, RuntimeEntityKind> = {
  Miner: 'miner',
  Belt: 'belt',
  Inserter: 'inserter',
  Furnace: 'furnace',
};

const ROTATION_TO_DIRECTION: Record<Rotation, RuntimeDirection> = {
  0: 'N',
  1: 'E',
  2: 'S',
  3: 'W',
};

const DIRECTION_TO_DELTA: Readonly<Record<RuntimeDirection, Tile>> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

const MOVE_HOTKEY_TO_DIRECTION: Readonly<Record<string, RuntimeDirection>> = {
  KeyW: 'N',
  ArrowUp: 'N',
  KeyD: 'E',
  ArrowRight: 'E',
  KeyS: 'S',
  ArrowDown: 'S',
  KeyA: 'W',
  ArrowLeft: 'W',
};

type RuntimePlayer = {
  x: number;
  y: number;
  rot: RuntimeDirection;
  fuel: number;
  maxFuel: number;
};

function createRuntimeSimulation(): RuntimeSimulation {
  const map = createMap(WORLD_WIDTH, WORLD_HEIGHT, WORLD_SEED);
  const coreSim = createSim({
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    seed: WORLD_SEED,
    map,
  });
  const player: RuntimePlayer = {
    x: Math.floor(WORLD_WIDTH / 2),
    y: Math.floor(WORLD_HEIGHT / 2),
    rot: 'S',
    fuel: PLAYER_MAX_FUEL,
    maxFuel: PLAYER_MAX_FUEL,
  };
  let intervalId: number | null = null;

  const inBounds = (tile: Tile): boolean =>
    tile.x >= 0 && tile.y >= 0 && tile.x < WORLD_WIDTH && tile.y < WORLD_HEIGHT;

  const hasEntityAt = (tile: Tile): boolean => {
    return coreSim.getEntitiesAt(tile).length > 0;
  };

  const canPlaceKind = (kind: EntityKind, tile: Tile): CoreActionOutcome => {
    if (!inBounds(tile)) {
      return { ok: false, reasonCode: 'out_of_bounds' };
    }
    if (player.fuel < PLAYER_BUILD_FUEL_COST) {
      return { ok: false, reasonCode: 'no_fuel' };
    }
    if (hasEntityAt(tile)) {
      return { ok: false, reasonCode: 'occupied' };
    }
    if (kind === 'Miner' && !map.isOre(tile.x, tile.y)) {
      return { ok: false, reasonCode: 'needs_resource' };
    }
    return { ok: true, reasonCode: 'ok' };
  };

  const placeEntity = (kind: EntityKind, tile: Tile, rotation: Rotation): CoreActionOutcome => {
    const canPlace = canPlaceKind(kind, tile);
    if (!canPlace.ok) {
      return canPlace;
    }

    coreSim.addEntity(RUNTIME_KIND[kind], {
      pos: { x: tile.x, y: tile.y },
      rot: ROTATION_TO_DIRECTION[rotation],
    });
    player.fuel = Math.max(0, player.fuel - PLAYER_BUILD_FUEL_COST);
    return { ok: true, reasonCode: 'placed' };
  };

  const removeEntityAt = (tile: Tile): CoreActionOutcome => {
    if (!inBounds(tile)) {
      return { ok: false, reasonCode: 'out_of_bounds' };
    }
    const entities = coreSim.getEntitiesAt(tile);
    const firstEntity = entities[0];
    if (!firstEntity) {
      return { ok: false, reasonCode: 'no_entity' };
    }

    const removed = coreSim.removeEntity(firstEntity.id);
    return removed ? { ok: true, reasonCode: 'removed' } : { ok: false, reasonCode: 'blocked' };
  };

  const movePlayer = (direction: RuntimeDirection): CoreActionOutcome => {
    const delta = DIRECTION_TO_DELTA[direction];
    const next = {
      x: player.x + delta.x,
      y: player.y + delta.y,
    };

    if (!inBounds(next)) {
      return { ok: false, reasonCode: 'out_of_bounds' };
    }
    if (player.fuel < PLAYER_MOVE_FUEL_COST) {
      return { ok: false, reasonCode: 'no_fuel' };
    }

    player.x = next.x;
    player.y = next.y;
    player.rot = direction;
    player.fuel = Math.max(0, player.fuel - PLAYER_MOVE_FUEL_COST);
    return { ok: true, reasonCode: 'moved' };
  };

  const refuel = (): CoreActionOutcome => {
    if (player.fuel >= player.maxFuel) {
      return { ok: false, reasonCode: 'fuel_full' };
    }

    const candidateTiles: Tile[] = [
      { x: player.x, y: player.y },
      { x: player.x + 1, y: player.y },
      { x: player.x - 1, y: player.y },
      { x: player.x, y: player.y + 1 },
      { x: player.x, y: player.y - 1 },
    ].filter(inBounds);

    for (const tile of candidateTiles) {
      const entities = coreSim.getEntitiesAt(tile);
      for (const entity of entities) {
        if (entity.kind !== 'furnace') {
          continue;
        }
        const internal = coreSim.getEntityById(entity.id);
        if (!internal || typeof internal.state !== 'object' || internal.state === null) {
          continue;
        }
        const state = internal.state as {
          provideItem?: (item: string) => string | null;
        };
        if (typeof state.provideItem !== 'function') {
          continue;
        }

        const consumed = state.provideItem('iron-plate');
        if (consumed === 'iron-plate') {
          player.fuel = Math.min(player.maxFuel, player.fuel + PLAYER_REFUEL_AMOUNT);
          return { ok: true, reasonCode: 'refueled' };
        }
      }
    }

    return { ok: false, reasonCode: 'no_fuel_source' };
  };

  const runtime: RuntimeSimulation = {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    tileSize: TILE_SIZE,
    get tick() {
      return coreSim.tick;
    },
    get tickCount() {
      return coreSim.tickCount;
    },
    get elapsedMs() {
      return coreSim.elapsedMs;
    },

    getMap: () => map,

    getAllEntities: () => coreSim.getAllEntities() as RuntimeEntity[],

    getPlacementSnapshot() {
      return {
        tick: runtime.tick,
        tickCount: runtime.tickCount,
        elapsedMs: runtime.elapsedMs,
        entityCount: coreSim.getAllEntities().length,
        fuel: player.fuel,
        maxFuel: player.maxFuel,
        player: { x: player.x, y: player.y },
      };
    },

    getPlayerSnapshot() {
      return {
        x: player.x,
        y: player.y,
        fuel: player.fuel,
        maxFuel: player.maxFuel,
        rot: player.rot,
      };
    },

    canRemove(tile) {
      return inBounds(tile) && coreSim.getEntitiesAt(tile).length > 0;
    },

    hasEntityAt(tile) {
      return inBounds(tile) && hasEntityAt(tile);
    },

    isResourceTile(tile) {
      return map.isOre(tile.x, tile.y);
    },

    getPlacementOutcome(kind, tile, _rotation) {
      return canPlaceKind(kind, tile);
    },

    canPlace(kind, tile, _rotation) {
      return canPlaceKind(kind, tile).ok === true;
    },

    placeEntity(kind, tile, rotation) {
      return placeEntity(kind, tile, rotation);
    },

    addEntity(kind, tile, rotation) {
      return placeEntity(kind, tile, rotation);
    },

    removeAt(tile) {
      return removeEntityAt(tile);
    },

    removeEntity(tile) {
      return removeEntityAt(tile);
    },

    togglePause() {
      coreSim.togglePause();
    },

    isPaused() {
      return coreSim.paused;
    },

    movePlayer(direction) {
      return movePlayer(direction);
    },

    refuel() {
      return refuel();
    },

    destroy() {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    },
  };

  intervalId = window.setInterval(() => {
    coreSim.step(SIM_STEP_MS);
  }, SIM_STEP_MS);

  return runtime;
}

function getCanRemoveOutcome(sim: Simulation, tile: Tile): boolean {
  if (typeof sim.canRemove === 'function') {
    return sim.canRemove(tile);
  }

  const hasEntityAt = (sim as { hasEntityAt?: (tile: Tile) => boolean }).hasEntityAt;
  if (typeof hasEntityAt === 'function') {
    return hasEntityAt(tile);
  }

  return false;
}

function getSimulationTick(sim: Simulation): number {
  const snapshot = (sim as { getPlacementSnapshot?: () => { tick?: number; tickCount?: number } }).getPlacementSnapshot;
  if (typeof snapshot === 'function') {
    const value = snapshot.call(sim);
    if (typeof value?.tick === 'number') {
      return value.tick;
    }
    if (typeof value?.tickCount === 'number') {
      return value.tickCount;
    }
  }

  const withTick = sim as { tick?: unknown; tickCount?: unknown };
  if (typeof withTick.tick === 'number') {
    return withTick.tick;
  }
  if (typeof withTick.tickCount === 'number') {
    return withTick.tickCount;
  }

  return 0;
}

function getSimulationPaused(sim: Simulation): boolean {
  const withMethod = sim as { isPaused?: () => boolean };
  if (typeof withMethod.isPaused === 'function') {
    return withMethod.isPaused();
  }

  const withFlag = sim as { paused?: unknown };
  return typeof withFlag.paused === 'boolean' ? withFlag.paused : false;
}

function getSimulationFuel(sim: Simulation): { fuel: number; maxFuel: number } | null {
  const snapshot = (sim as {
    getPlacementSnapshot?: () => { fuel?: number; maxFuel?: number };
  }).getPlacementSnapshot;
  if (typeof snapshot === 'function') {
    const value = snapshot.call(sim);
    if (typeof value?.fuel === 'number' && typeof value?.maxFuel === 'number') {
      return { fuel: value.fuel, maxFuel: value.maxFuel };
    }
  }
  return null;
}

function getSimulationPlayer(sim: Simulation): Tile | null {
  const snapshot = (sim as {
    getPlacementSnapshot?: () => { player?: { x?: number; y?: number } };
  }).getPlacementSnapshot;
  if (typeof snapshot === 'function') {
    const value = snapshot.call(sim);
    if (typeof value?.player?.x === 'number' && typeof value?.player?.y === 'number') {
      return { x: value.player.x, y: value.player.y };
    }
  }

  const direct = sim as { player?: { x?: unknown; y?: unknown } };
  if (typeof direct.player?.x === 'number' && typeof direct.player?.y === 'number') {
    return { x: direct.player.x, y: direct.player.y };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getSimulationMetrics(sim: Simulation): RuntimeMetrics | null {
  const withEntities = sim as { getAllEntities?: () => RuntimeEntity[] };
  if (typeof withEntities.getAllEntities !== 'function') {
    return null;
  }

  const entities = withEntities.getAllEntities();
  if (!Array.isArray(entities)) {
    return null;
  }

  const metrics: RuntimeMetrics = {
    entityCount: entities.length,
    miners: 0,
    belts: 0,
    inserters: 0,
    furnaces: 0,
    oreInTransit: 0,
    platesInTransit: 0,
    furnacesCrafting: 0,
    furnacesReady: 0,
  };

  for (const entity of entities) {
    if (entity.kind === 'miner') {
      metrics.miners += 1;
      continue;
    }

    if (entity.kind === 'belt') {
      metrics.belts += 1;
      const beltState = isRecord(entity.state) ? entity.state : null;
      const beltItem = typeof beltState?.item === 'string' ? beltState.item : null;
      if (beltItem === 'iron-ore') {
        metrics.oreInTransit += 1;
      } else if (beltItem === 'iron-plate') {
        metrics.platesInTransit += 1;
      }
      continue;
    }

    if (entity.kind === 'inserter') {
      metrics.inserters += 1;
      const inserterState = isRecord(entity.state) ? entity.state : null;
      const held = typeof inserterState?.holding === 'string' ? inserterState.holding : null;
      if (held === 'iron-ore') {
        metrics.oreInTransit += 1;
      } else if (held === 'iron-plate') {
        metrics.platesInTransit += 1;
      }
      continue;
    }

    if (entity.kind === 'furnace') {
      metrics.furnaces += 1;
      const furnaceState = isRecord(entity.state) ? entity.state : null;
      const output = typeof furnaceState?.output === 'string' ? furnaceState.output : null;
      const outputOccupied = furnaceState?.outputOccupied === true;
      const progress =
        typeof furnaceState?.progress01 === 'number' ? furnaceState.progress01 : null;

      if (output === 'iron-plate' || outputOccupied) {
        metrics.furnacesReady += 1;
      } else if (progress !== null && progress > 0 && progress < 1) {
        metrics.furnacesCrafting += 1;
      }
    }
  }

  return metrics;
}

function describeKindOrTarget(kind: EntityKind | null, tile: Tile | null): string {
  const prefix = kind === null ? 'Selection' : kind;
  const suffix = tile === null ? '' : ` at (${tile.x}, ${tile.y})`;
  return `${prefix}${suffix}`;
}

function ensureSimulation(): RuntimeSimulation {
  if (window.__SIM__ && typeof window.__SIM__ === 'object') {
    return window.__SIM__ as RuntimeSimulation;
  }
  const created = createRuntimeSimulation();
  window.__SIM__ = created;
  return created;
}

const NOOP_SIMULATION: Simulation = {
  canPlace(_kind: EntityKind, _tile: Tile, _rotation: Rotation): boolean {
    return false;
  },
  addEntity(_kind: EntityKind, _tile: Tile, _rotation: Rotation): void {
    // no-op fallback when no simulation is attached
  },
  removeEntity(_tile: Tile): void {
    // no-op fallback when no simulation is attached
  },
  togglePause(): void {
    // no-op fallback when no simulation is attached
  },
};

function isSimulation(value: unknown): value is Simulation {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const sim = value as Partial<Simulation>;

  return (
    typeof sim.canPlace === 'function' &&
    typeof sim.addEntity === 'function' &&
    typeof sim.removeEntity === 'function'
  );
}

function getSimulation(): Simulation {
  const sim = ensureSimulation();
  return isSimulation(sim) ? sim : NOOP_SIMULATION;
}

function pointerToTile(event: PointerEvent, canvas: HTMLCanvasElement): Tile | null {
  const rect = canvas.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;

  if (localX < 0 || localY < 0 || localX >= rect.width || localY >= rect.height) {
    return null;
  }

  const worldW = WORLD_WIDTH * TILE_SIZE;
  const worldH = WORLD_HEIGHT * TILE_SIZE;
  if (worldW <= 0 || worldH <= 0) {
    return null;
  }

  const canvasWidth = canvas.width > 0 ? canvas.width : rect.width;
  const canvasHeight = canvas.height > 0 ? canvas.height : rect.height;
  const scale = Math.max(0.0001, Math.min(canvasWidth / worldW, canvasHeight / worldH));
  const tileSpan = TILE_SIZE * scale;
  const viewW = worldW * scale;
  const viewH = worldH * scale;
  const offsetX = Math.floor((canvasWidth - viewW) / 2);
  const offsetY = Math.floor((canvasHeight - viewH) / 2);

  const gridLocalX = localX - offsetX;
  const gridLocalY = localY - offsetY;
  if (gridLocalX < 0 || gridLocalY < 0 || gridLocalX >= viewW || gridLocalY >= viewH) {
    return null;
  }

  const x = Math.floor(gridLocalX / tileSpan);
  const y = Math.floor(gridLocalY / tileSpan);
  if (x < 0 || y < 0 || x >= WORLD_WIDTH || y >= WORLD_HEIGHT) {
    return null;
  }

  return {
    x,
    y,
  };
}

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<ReturnType<typeof createPlacementController> | null>(null);
  const rendererRef = useRef<RendererApi | null>(null);
  const simulationRef = useRef<Simulation>(NOOP_SIMULATION);
  const feedbackTimeoutRef = useRef<number | null>(null);
  const initialHud: HudState = {
    tool: null,
    rotation: 0,
    paused: false,
    tick: 0,
    fuel: PLAYER_MAX_FUEL,
    maxFuel: PLAYER_MAX_FUEL,
    player: {
      x: Math.floor(WORLD_WIDTH / 2),
      y: Math.floor(WORLD_HEIGHT / 2),
    },
    metrics: {
      entityCount: 0,
      miners: 0,
      belts: 0,
      inserters: 0,
      furnaces: 0,
      oreInTransit: 0,
      platesInTransit: 0,
      furnacesCrafting: 0,
      furnacesReady: 0,
    },
  };
  const [selectedKind, setSelectedKind] = useState(null as EntityKind | null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [useSvgs, setUseSvgs] = useState(true);
  const hudRef = useRef<HudState>(initialHud);
  if (hudRef.current === null) {
    hudRef.current = initialHud;
  }
  const [hud, setHud] = useState<HudState>(initialHud);

  const setHudState = useCallback(
    (patch: Partial<HudState>): void => {
      const current = hudRef.current ?? initialHud;
      const next: HudState = {
        tool: patch.tool === undefined ? current.tool : patch.tool,
        rotation: patch.rotation === undefined ? current.rotation : patch.rotation,
        paused: patch.paused === undefined ? current.paused : patch.paused,
        tick: patch.tick === undefined ? current.tick : patch.tick,
        fuel: patch.fuel === undefined ? current.fuel : patch.fuel,
        maxFuel: patch.maxFuel === undefined ? current.maxFuel : patch.maxFuel,
        player: patch.player === undefined ? current.player : patch.player,
        metrics: patch.metrics === undefined ? current.metrics : patch.metrics,
      };

      if (
        current.tool === next.tool &&
        current.rotation === next.rotation &&
        current.paused === next.paused &&
        current.tick === next.tick &&
        current.fuel === next.fuel &&
        current.maxFuel === next.maxFuel &&
        current.player.x === next.player.x &&
        current.player.y === next.player.y &&
        current.metrics.entityCount === next.metrics.entityCount &&
        current.metrics.miners === next.metrics.miners &&
        current.metrics.belts === next.metrics.belts &&
        current.metrics.inserters === next.metrics.inserters &&
        current.metrics.furnaces === next.metrics.furnaces &&
        current.metrics.oreInTransit === next.metrics.oreInTransit &&
        current.metrics.platesInTransit === next.metrics.platesInTransit &&
        current.metrics.furnacesCrafting === next.metrics.furnacesCrafting &&
        current.metrics.furnacesReady === next.metrics.furnacesReady
      ) {
        return;
      }

      hudRef.current = next;
      setHud(next);
    },
    [setHud],
  );

  const syncPaletteFromController = useCallback((): void => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }

    const state = controller.getState();
    setSelectedKind(state.selectedKind);
    setHudState({
      tool: state.selectedKind,
      rotation: state.rotation,
    });
  }, [setHudState]);

  const syncHudFromSimulation = useCallback((): void => {
    const sim = simulationRef.current;
    if (!sim) {
      return;
    }
    const nextTick = getSimulationTick(sim);
    const nextPaused = getSimulationPaused(sim);
    const nextFuel = getSimulationFuel(sim);
    const nextPlayer = getSimulationPlayer(sim);
    const nextMetrics = getSimulationMetrics(sim);
    setHudState({
      tick: nextTick,
      paused: nextPaused,
      ...(nextFuel === null ? {} : { fuel: nextFuel.fuel, maxFuel: nextFuel.maxFuel }),
      ...(nextPlayer === null ? {} : { player: nextPlayer }),
      ...(nextMetrics === null ? {} : { metrics: nextMetrics }),
    });
  }, [setHudState]);

  const syncGhostFromController = useCallback((): void => {
    const controller = controllerRef.current;
    const renderer = rendererRef.current;

    if (!controller || !renderer) {
      return;
    }

    const ghost = controller.getGhost();
    renderer.setGhost(ghost.tile, ghost.valid);
  }, []);

  const setFeedbackMessage = useCallback((nextFeedback: Feedback | null): void => {
    if (feedbackTimeoutRef.current !== null) {
      window.clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = null;
    }

    if (nextFeedback === null) {
      setFeedback(null);
      return;
    }

    setFeedback(nextFeedback);
    feedbackTimeoutRef.current = window.setTimeout((): void => {
      setFeedback(null);
      feedbackTimeoutRef.current = null;
    }, 1400);
  }, []);

  const onPaletteSelect = useCallback(
    (kind: EntityKind): void => {
      const controller = controllerRef.current;
      if (!controller) {
        return;
      }

      controller.selectKind(kind);
      syncPaletteFromController();
      syncGhostFromController();
    },
    [syncGhostFromController, syncPaletteFromController],
  );

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;

    if (!container || !canvas) {
      return;
    }

    const sim = getSimulation();
    const controller = createPlacementController(sim);
    const renderer = createRenderer(canvas) as unknown as RendererApi;

    simulationRef.current = sim;
    controllerRef.current = controller;
    rendererRef.current = renderer;

    const initialKind = ALL_ENTITY_KINDS[0];
    if (initialKind !== undefined) {
      controller.selectKind(initialKind);
    }

    const syncFromController = (): void => {
      syncPaletteFromController();
      syncGhostFromController();
      syncHudFromSimulation();
    };

    // Default to SVG rendering so imported art is visible immediately.
    window.__USE_SVGS__ = true;
    preloadRendererSvgs();

    const resizeCanvas = (): void => {
      const width = Math.max(1, Math.floor(container.clientWidth));
      const height = Math.max(1, Math.floor(container.clientHeight));

      if (canvas.width !== width) {
        canvas.width = width;
      }
      if (canvas.height !== height) {
        canvas.height = height;
      }

      renderer.resize?.(width, height);
      syncGhostFromController();
    };

    const onPointerMove = (event: PointerEvent): void => {
      controller.setCursor(pointerToTile(event, canvas));
      syncGhostFromController();
    };

    const onPointerLeave = (): void => {
      controller.setCursor(null);
      syncGhostFromController();
    };

    const onMouseDown = (event: MouseEvent): void => {
      if (event.button === 0) {
        const controllerState = controller.getState();
        const tile = controllerState.cursor;

        if (controllerState.selectedKind === null || tile === null) {
          setFeedbackMessage({
            kind: 'error',
            message: `Unable to place ${describeKindOrTarget(controllerState.selectedKind, tile)}.`,
          });
          return;
        }

        const placementFeedback = controller.clickLMB();
        if (!placementFeedback.ok) {
          const normalizedReason = String(placementFeedback.reason ?? '').toLowerCase();
          const blockedMessage =
            normalizedReason === 'no_fuel'
              ? 'Out of fuel. Refuel near a furnace with F.'
              : `Placement blocked for ${describeKindOrTarget(controllerState.selectedKind, tile)}.`;
          setFeedbackMessage({
            kind: 'error',
            message: blockedMessage,
          });
          syncFromController();
          return;
        }

        setFeedbackMessage({
          kind: 'success',
          message: `Placed ${controllerState.selectedKind} at (${tile.x}, ${tile.y}).`,
        });
        syncFromController();
        return;
      }

      if (event.button === 2) {
        event.preventDefault();
        const controllerState = controller.getState();
        const tile = controllerState.cursor;

        if (tile === null) {
          setFeedbackMessage({
            kind: 'error',
            message: 'No tile targeted for removal.',
          });
          return;
        }

        if (!getCanRemoveOutcome(sim, tile)) {
          setFeedbackMessage({
            kind: 'error',
            message: `Nothing to remove at (${tile.x}, ${tile.y}).`,
          });
          return;
        }

        const removalFeedback = controller.clickRMB();
        if (!removalFeedback.ok) {
          setFeedbackMessage({
            kind: 'error',
            message: `${removalFeedback.message} at (${tile.x}, ${tile.y}).`,
          });
          syncFromController();
          return;
        }

        setFeedbackMessage({
          kind: 'success',
          message: `Removed entity at (${tile.x}, ${tile.y}).`,
        });
        syncFromController();
      }
    };

    const onContextMenu = (event: MouseEvent): void => {
      event.preventDefault();
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code in HOTKEY_TO_KIND) {
        const hotkey = event.code as keyof typeof HOTKEY_TO_KIND;
        controller.selectKind(HOTKEY_TO_KIND[hotkey]);
        syncFromController();
        event.preventDefault();
        return;
      }

      if (event.code === 'KeyR') {
        controller.rotate();
        syncFromController();
        event.preventDefault();
        return;
      }

      if (event.code === 'Space') {
        sim.togglePause?.();
        syncHudFromSimulation();
        event.preventDefault();
        return;
      }

      if (event.code in MOVE_HOTKEY_TO_DIRECTION) {
        const mover = sim as { movePlayer?: (direction: RuntimeDirection) => CoreActionOutcome };
        const movePlayerFn = mover.movePlayer;
        if (typeof movePlayerFn === 'function') {
          const direction = MOVE_HOTKEY_TO_DIRECTION[event.code];
          if (!direction) {
            return;
          }
          const outcome = movePlayerFn(direction);
          if (outcome?.ok) {
            setFeedbackMessage({
              kind: 'success',
              message: `Moved ${direction}.`,
            });
          } else {
            const reason = String(outcome?.reasonCode ?? 'blocked');
            setFeedbackMessage({
              kind: 'error',
              message: reason === 'no_fuel' ? 'Out of fuel. Press F near furnace output.' : 'Movement blocked.',
            });
          }
          syncHudFromSimulation();
          event.preventDefault();
        }
        return;
      }

      if (event.code === 'KeyF') {
        const withRefuel = sim as { refuel?: () => CoreActionOutcome };
        if (typeof withRefuel.refuel === 'function') {
          const outcome = withRefuel.refuel();
          if (outcome?.ok) {
            setFeedbackMessage({
              kind: 'success',
              message: `Refueled +${PLAYER_REFUEL_AMOUNT}.`,
            });
          } else {
            const reason = String(outcome?.reasonCode ?? 'blocked');
            const message =
              reason === 'fuel_full'
                ? 'Fuel already full.'
                : 'No iron-plate output nearby for refuel.';
            setFeedbackMessage({
              kind: 'error',
              message,
            });
          }
          syncHudFromSimulation();
          event.preventDefault();
        }
      }
    };

    const hudIntervalId = window.setInterval((): void => {
      syncHudFromSimulation();
    }, 250);

    resizeCanvas();
    syncFromController();

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', resizeCanvas);

    return () => {
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', resizeCanvas);

      window.clearInterval(hudIntervalId);
      renderer.destroy();
      rendererRef.current = null;
      controllerRef.current = null;
      simulationRef.current = NOOP_SIMULATION;

      const maybeRuntime = window.__SIM__;
      if (
        maybeRuntime &&
        typeof maybeRuntime === 'object' &&
        'destroy' in maybeRuntime &&
        typeof (maybeRuntime as { destroy?: unknown }).destroy === 'function'
      ) {
        (maybeRuntime as { destroy: () => void }).destroy();
      }
      if (feedbackTimeoutRef.current !== null) {
        window.clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }
      delete window.__SIM__;
    };
  }, [syncGhostFromController, syncHudFromSimulation, syncPaletteFromController]);

  const hudToolValue = hud.tool ?? 'None';
  const hudRotationValue = ROTATION_TO_DIRECTION[hud.rotation];
  const hudPauseValue = hud.paused ? 'Paused' : 'Running';

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        overflow: 'hidden',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
        }}
      />

      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          zIndex: 1,
        }}
      >
        <PaletteView selectedKind={selectedKind} onSelectKind={onPaletteSelect} />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 1,
        }}
      >
        <button
          onClick={() => {
            const current = !!window.__USE_SVGS__;
            window.__USE_SVGS__ = !current;
            setUseSvgs(!current);
          }}
          style={{
            padding: '8px 16px',
            borderRadius: 8,
            border: 'none',
            background: useSvgs ? '#228B22' : '#444',
            color: 'white',
            cursor: 'pointer',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 14,
            fontWeight: 'bold',
            boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
          }}
        >
          {useSvgs ? 'SVGs Enabled' : 'Enable SVGs'}
        </button>
      </div>
      <div
        data-testid="hud"
        style={{
          position: 'absolute',
          left: 12,
          bottom: 12,
          zIndex: 1,
          padding: '8px 10px',
          borderRadius: 8,
          background: 'rgba(20, 20, 20, 0.75)',
          color: 'white',
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          fontSize: 12,
          lineHeight: 1.35,
          userSelect: 'none',
        }}
      >
        <div data-testid="hud-tool">
          <span>Tool:</span>{' '}
          <span data-testid="hud-tool-value" data-value={hudToolValue}>
            {hudToolValue}
          </span>
        </div>
        <div data-testid="hud-rotation">
          <span>Rotation:</span>{' '}
          <span data-testid="hud-rotation-value" data-value={hudRotationValue}>
            {hudRotationValue}
          </span>
        </div>
        <div data-testid="hud-pause">
          <span>Pause:</span>{' '}
          <span data-testid="hud-pause-value" data-value={hudPauseValue.toLowerCase()}>
            {hudPauseValue}
          </span>
        </div>
        <div data-testid="hud-tick">
          <span>Tick:</span>{' '}
          <span data-testid="hud-tick-value" data-value={String(hud.tick)}>
            {hud.tick}
          </span>
        </div>
        <div data-testid="hud-player">
          <span>Player:</span>{' '}
          <span data-testid="hud-player-value" data-value={`${hud.player.x},${hud.player.y}`}>
            ({hud.player.x}, {hud.player.y})
          </span>
        </div>
        <div data-testid="hud-fuel">
          <span>Fuel:</span>{' '}
          <span data-testid="hud-fuel-value" data-value={`${hud.fuel}/${hud.maxFuel}`}>
            {hud.fuel}/{hud.maxFuel}
          </span>
        </div>
        <div data-testid="hud-entities">
          <span>Entities:</span>{' '}
          <span
            data-testid="hud-entities-value"
            data-value={`${hud.metrics.entityCount}`}
          >
            {hud.metrics.entityCount}
          </span>{' '}
          <span style={{ opacity: 0.75 }}>
            (M{hud.metrics.miners}/B{hud.metrics.belts}/I{hud.metrics.inserters}/F{hud.metrics.furnaces})
          </span>
        </div>
        <div data-testid="hud-flow">
          <span>Transit:</span>{' '}
          <span
            data-testid="hud-flow-value"
            data-value={`${hud.metrics.oreInTransit}/${hud.metrics.platesInTransit}`}
          >
            ore {hud.metrics.oreInTransit} · plate {hud.metrics.platesInTransit}
          </span>
        </div>
        <div data-testid="hud-furnace">
          <span>Furnaces:</span>{' '}
          <span
            data-testid="hud-furnace-value"
            data-value={`${hud.metrics.furnacesCrafting}/${hud.metrics.furnacesReady}`}
          >
            crafting {hud.metrics.furnacesCrafting} · ready {hud.metrics.furnacesReady}
          </span>
        </div>
        <div data-testid="hud-controls-note">
          <span>Move:</span> WASD / Arrows · <span>Refuel:</span> F
        </div>
      </div>
      {feedback === null ? null : (
        <div
          style={{
            position: 'absolute',
            top: 60,
            right: 12,
            zIndex: 1,
            maxWidth: 260,
            padding: '8px 10px',
            borderRadius: 8,
            background: feedback.kind === 'success' ? 'rgba(34, 139, 34, 0.85)' : 'rgba(139, 0, 0, 0.85)',
            color: 'white',
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 12,
            lineHeight: 1.25,
            userSelect: 'none',
          }}
          role="status"
          aria-live="polite"
        >
          {feedback.message}
        </div>
      )}
    </div>
  );
}

declare global {
  interface Window {
    __SIM__?: unknown;
    __USE_SVGS__?: boolean;
  }
}
