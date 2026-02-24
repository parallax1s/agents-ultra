import { describe, expect, it } from 'vitest';

import {
  computeCameraPanForTile,
  minimapPointToTile,
  pointerToTile,
  type CameraState,
} from '../src/ui/App';

type Tile = { x: number; y: number };

const WORLD_WIDTH = 60;
const WORLD_HEIGHT = 40;
const TILE_SIZE = 32;

const DEFAULT_CANVAS_WIDTH = 960;
const DEFAULT_CANVAS_HEIGHT = 640;

const createCanvas = (width: number, height: number): HTMLCanvasElement => ({
  width,
  height,
  getBoundingClientRect: () => ({
    width,
    height,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: (): Record<string, never> => ({}),
  }),
}) as unknown as HTMLCanvasElement;

const pointAtTileCenter = (tile: Tile, camera: CameraState, canvasWidth: number, canvasHeight: number): { x: number; y: number } => {
  const worldW = WORLD_WIDTH * TILE_SIZE;
  const worldH = WORLD_HEIGHT * TILE_SIZE;
  const baseScale = Math.max(0.0001, Math.min(canvasWidth / worldW, canvasHeight / worldH));
  const scale = baseScale * camera.zoom;
  const baseOffsetX = Math.floor((canvasWidth - worldW * baseScale) / 2);
  const baseOffsetY = Math.floor((canvasHeight - worldH * baseScale) / 2);
  return {
    x: Math.round(baseOffsetX + camera.panX + (tile.x + 0.5) * TILE_SIZE * scale),
    y: Math.round(baseOffsetY + camera.panY + (tile.y + 0.5) * TILE_SIZE * scale),
  };
};

describe('camera math', () => {
  it('computes camera pan for a tile using consistent base-offset scaling', () => {
    const tile = { x: 12, y: 9 };
    const camera = computeCameraPanForTile({
      tile,
      zoom: 2,
      canvasWidth: DEFAULT_CANVAS_WIDTH,
      canvasHeight: DEFAULT_CANVAS_HEIGHT,
    });

    expect(camera).toEqual({
      zoom: 2,
      panX: 80,
      panY: 16,
    });
  });

  it('maps a zoomed center position back to the expected tile', () => {
    const tile = { x: 12, y: 9 };
    const canvas = createCanvas(DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT);
    const camera = computeCameraPanForTile({
      tile,
      zoom: 2,
      canvasWidth: DEFAULT_CANVAS_WIDTH,
      canvasHeight: DEFAULT_CANVAS_HEIGHT,
    });
    const point = pointAtTileCenter(tile, camera, DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT);

    const mapped = pointerToTile(
      {
        clientX: point.x,
        clientY: point.y,
      } as unknown as PointerEvent,
      canvas,
      camera,
    );

    expect(mapped).toEqual(tile);
  });

  it('maps a tile from an arbitrary zoom and pan combination deterministically', () => {
    const tile = { x: 5, y: 7 };
    const canvas = createCanvas(1200, 720);
    const camera = computeCameraPanForTile({
      tile: { x: 24, y: 18 },
      zoom: 1.5,
      canvasWidth: 1200,
      canvasHeight: 720,
    });
    const point = pointAtTileCenter({ x: 24, y: 18 }, camera, 1200, 720);

    const mapped = pointerToTile(
      {
        clientX: point.x,
        clientY: point.y,
      } as unknown as PointerEvent,
      canvas,
      camera,
    );

    expect(mapped).toEqual({ x: 24, y: 18 });
    expect(camera.zoom).toBe(1.5);
    expect(camera.panX).toBe(-121);
    expect(camera.panY).toBe(-139);
  });

  it('maps minimap clicks to world tiles', () => {
    const tile = minimapPointToTile({
      point: {
        x: 8,
        y: 6,
      },
      minimapWidth: 60,
      minimapHeight: 40,
      worldWidth: 12,
      worldHeight: 8,
    });
    expect(tile).toEqual({ x: 1, y: 1 });
  });

  it('ignores minimap clicks outside the minimap bounds', () => {
    const tile = minimapPointToTile({
      point: {
        x: -4,
        y: 4,
      },
      minimapWidth: 60,
      minimapHeight: 40,
      worldWidth: 12,
      worldHeight: 8,
    });
    expect(tile).toBeNull();
  });

  it('maps a scaled minimap coordinate to expected tile index', () => {
    const tile = minimapPointToTile({
      point: {
        x: 55,
        y: 49,
      },
      minimapWidth: 120,
      minimapHeight: 80,
      worldWidth: 12,
      worldHeight: 8,
    });
    expect(tile).toEqual({ x: 5, y: 4 });
  });
});
