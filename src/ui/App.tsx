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

const TILE_SIZE = 32;

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
  return isSimulation(window.__SIM__) ? window.__SIM__ : NOOP_SIMULATION;
}

function pointerToTile(event: PointerEvent, canvas: HTMLCanvasElement): Tile | null {
  const rect = canvas.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;

  if (localX < 0 || localY < 0 || localX >= rect.width || localY >= rect.height) {
    return null;
  }

  return {
    x: Math.floor(localX / TILE_SIZE),
    y: Math.floor(localY / TILE_SIZE),
  };
}

export default function App() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<ReturnType<typeof createPlacementController> | null>(null);
  const rendererRef = useRef<RendererApi | null>(null);
  const [selectedKind, setSelectedKind] = useState(null as EntityKind | null);

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
        controller.clickLMB();
        syncFromController();
        return;
      }

      if (event.button === 2) {
        event.preventDefault();
        controller.clickRMB();
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
    </div>
  );
}

declare global {
  interface Window {
    __SIM__?: unknown;
  }
}
