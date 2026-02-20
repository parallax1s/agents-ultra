/// <reference path="../types/react-shim.d.ts" />
/// <reference path="../types/modules.d.ts" />

import { useCallback, useEffect, useRef, useState } from 'react';

import Palette from './palette';
import {
  ALL_ENTITY_KINDS,
  createPlacementController,
  type EntityKind,
  type Rotation,
  type Simulation,
} from './placement';
import { createRenderer } from './renderer';
import { createMap } from '../core/map';

const TILE_SIZE = 32;
const WORLD_WIDTH = 60;
const WORLD_HEIGHT = 40;
const WORLD_SEED = 'agents-ultra';

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
};

type RuntimeSimulation = Simulation & {
  width: number;
  height: number;
  tileSize: number;
  tick: number;
  tickCount: number;
  elapsedMs: number;
  getMap: () => ReturnType<typeof createMap>;
  getAllEntities: () => RuntimeEntity[];
  getPlacementSnapshot: () => PlacementSnapshot;
  destroy: () => void;
};

type Feedback = {
  kind: 'success' | 'error';
  message: string;
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

function createRuntimeSimulation(): RuntimeSimulation {
  const map = createMap(WORLD_WIDTH, WORLD_HEIGHT, WORLD_SEED);
  const entities = new Map<string, RuntimeEntity>();
  const indexByTile = new Map<string, string>();
  let nextId = 1;
  let paused = false;
  let intervalId: number | null = null;

  const toKey = (tile: Tile): string => `${tile.x},${tile.y}`;
  const inBounds = (tile: Tile): boolean =>
    tile.x >= 0 && tile.y >= 0 && tile.x < WORLD_WIDTH && tile.y < WORLD_HEIGHT;

  const runtime: RuntimeSimulation = {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    tileSize: TILE_SIZE,
    tick: 0,
    tickCount: 0,
    elapsedMs: 0,

    getMap: () => map,

      getAllEntities: () => Array.from(entities.values()),

      getPlacementSnapshot() {
        return {
          tick: runtime.tick,
          tickCount: runtime.tickCount,
          elapsedMs: runtime.elapsedMs,
          entityCount: entities.size,
        };
      },

      canRemove(tile) {
        return indexByTile.has(toKey(tile));
      },

      hasEntityAt(tile) {
        return indexByTile.has(toKey(tile));
      },

      isResourceTile(tile) {
        return map.isOre(tile.x, tile.y);
      },

      canPlace(kind, tile, _rotation) {
        if (!inBounds(tile)) {
          return false;
      }

      const tileKey = toKey(tile);
      if (indexByTile.has(tileKey)) {
        return false;
      }

      if (kind === 'Miner') {
        return map.isOre(tile.x, tile.y);
      }

      return true;
    },

    addEntity(kind, tile, rotation) {
      if (!runtime.canPlace(kind, tile, rotation)) {
        return;
      }

      const id = String(nextId++);
      const rot = ROTATION_TO_DIRECTION[rotation];
      const runtimeKind = RUNTIME_KIND[kind];
      const entity: RuntimeEntity = {
        id,
        kind: runtimeKind,
        pos: { x: tile.x, y: tile.y },
        rot,
      };
      entities.set(id, entity);
      indexByTile.set(toKey(tile), id);
    },

    removeEntity(tile) {
      const tileKey = toKey(tile);
      const id = indexByTile.get(tileKey);
      if (!id) {
        return;
      }
      indexByTile.delete(tileKey);
      entities.delete(id);
    },

    togglePause() {
      paused = !paused;
    },

    destroy() {
      if (intervalId !== null) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    },
  };

  intervalId = window.setInterval(() => {
    if (paused) {
      return;
    }
    runtime.tick += 1;
    runtime.tickCount += 1;
    runtime.elapsedMs += Math.round(1000 / 60);
  }, 1000 / 60);

  return runtime;
}

function getPlacementEntityCount(sim: Simulation): number | null {
  const snapshot = (sim as { getPlacementSnapshot?: () => { entityCount: number } }).getPlacementSnapshot;
  if (typeof snapshot !== 'function') {
    return null;
  }

  const value = snapshot.call(sim);
  return typeof value?.entityCount === 'number' ? value.entityCount : null;
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
  const feedbackTimeoutRef = useRef<number | null>(null);
  const [selectedKind, setSelectedKind] = useState(null as EntityKind | null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const syncPaletteFromController = useCallback((): void => {
    const controller = controllerRef.current;
    if (!controller) {
      return;
    }

    setSelectedKind(controller.getState().selectedKind);
  }, []);

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

    controllerRef.current = controller;
    rendererRef.current = renderer;

    const initialKind = ALL_ENTITY_KINDS[0];
    if (initialKind !== undefined) {
      controller.selectKind(initialKind);
    }

    const syncFromController = (): void => {
      syncPaletteFromController();
      syncGhostFromController();
    };

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
        const initialCount = getPlacementEntityCount(sim);

        if (controllerState.selectedKind === null || tile === null) {
          setFeedbackMessage({
            kind: 'error',
            message: `Unable to place ${describeKindOrTarget(controllerState.selectedKind, tile)}.`,
          });
          return;
        }

        if (!controllerState.canPlace) {
          setFeedbackMessage({
            kind: 'error',
            message: `Placement blocked for ${describeKindOrTarget(controllerState.selectedKind, tile)}.`,
          });
          return;
        }

        controller.clickLMB();
        const nextCount = getPlacementEntityCount(sim);
        if (initialCount !== null && nextCount !== null && nextCount <= initialCount) {
          setFeedbackMessage({
            kind: 'error',
            message: `Failed to place ${describeKindOrTarget(controllerState.selectedKind, tile)}.`,
          });
        } else {
          setFeedbackMessage({
            kind: 'success',
            message: `Placed ${controllerState.selectedKind} at (${tile.x}, ${tile.y}).`,
          });
        }
        syncFromController();
        return;
      }

      if (event.button === 2) {
        event.preventDefault();
        const controllerState = controller.getState();
        const tile = controllerState.cursor;
        const initialCount = getPlacementEntityCount(sim);

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

        controller.clickRMB();
        const nextCount = getPlacementEntityCount(sim);
        if (initialCount !== null && nextCount !== null && nextCount >= initialCount) {
          setFeedbackMessage({
            kind: 'error',
            message: `Failed to remove at (${tile.x}, ${tile.y}).`,
          });
        } else {
          setFeedbackMessage({
            kind: 'success',
            message: `Removed entity at (${tile.x}, ${tile.y}).`,
          });
        }
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
        event.preventDefault();
      }
    };

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

      renderer.destroy();
      rendererRef.current = null;
      controllerRef.current = null;

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
  }, [syncGhostFromController, syncPaletteFromController]);

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
      {feedback === null ? null : (
        <div
          style={{
            position: 'absolute',
            top: 12,
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
  }
}
