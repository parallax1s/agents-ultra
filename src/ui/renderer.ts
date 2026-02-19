import * as PIXI from "pixi.js";

const DEFAULT_TILE_SIZE = 32;
const GRID_COLOR = 0x3e4a57;
const ORE_COLOR = 0xc47f2d;
const HOVER_COLOR = 0x8be9fd;
const HOVER_LINE_WIDTH = 2;

export type GridSize = {
  cols: number;
  rows: number;
};

export type Coord = {
  x: number;
  y: number;
};

export type RendererInit = {
  container: HTMLElement;
  gridSize: GridSize;
  tileSize?: number;
};

export type RendererMetrics = {
  tileSize: number;
  gridSize: GridSize;
};

export type Renderer = {
  app: PIXI.Application;
  stage: PIXI.Container;
  metrics: RendererMetrics;
  setOre(ore: ReadonlyArray<Coord>): void;
  setHover(coord: Coord | null): void;
  render(): void;
  getView(): HTMLCanvasElement;
  destroy(): void;
};

function isInBounds(coord: Coord, gridSize: GridSize): boolean {
  return (
    coord.x >= 0 &&
    coord.y >= 0 &&
    coord.x < gridSize.cols &&
    coord.y < gridSize.rows
  );
}

function drawGridLayer(
  gridGraphics: PIXI.Graphics,
  tileSize: number,
  gridSize: GridSize,
  resolution: number,
): void {
  const lineWidth = 1 / resolution;
  const lineOffset = lineWidth / 2;

  gridGraphics.clear();
  gridGraphics.lineStyle({ color: GRID_COLOR, width: lineWidth, alignment: 0.5 });

  for (let col = 0; col <= gridSize.cols; col += 1) {
    const x = col * tileSize + lineOffset;
    gridGraphics.moveTo(x, 0);
    gridGraphics.lineTo(x, gridSize.rows * tileSize);
  }

  for (let row = 0; row <= gridSize.rows; row += 1) {
    const y = row * tileSize + lineOffset;
    gridGraphics.moveTo(0, y);
    gridGraphics.lineTo(gridSize.cols * tileSize, y);
  }
}

function drawOreLayer(
  oreGraphics: PIXI.Graphics,
  oreCoords: ReadonlyArray<Coord>,
  tileSize: number,
): void {
  oreGraphics.clear();
  oreGraphics.beginFill(ORE_COLOR);
  for (const ore of oreCoords) {
    oreGraphics.drawRect(ore.x * tileSize, ore.y * tileSize, tileSize, tileSize);
  }
  oreGraphics.endFill();
}

function drawHoverLayer(
  hoverGraphics: PIXI.Graphics,
  hoverCoord: Coord | null,
  tileSize: number,
  resolution: number,
): void {
  const hoverLineWidth = HOVER_LINE_WIDTH / resolution;
  const hoverInset = hoverLineWidth / 2;

  hoverGraphics.clear();
  if (hoverCoord === null) {
    return;
  }

  hoverGraphics.lineStyle({ color: HOVER_COLOR, width: hoverLineWidth, alignment: 0.5 });
  hoverGraphics.drawRect(
    hoverCoord.x * tileSize + hoverInset,
    hoverCoord.y * tileSize + hoverInset,
    tileSize - hoverLineWidth,
    tileSize - hoverLineWidth,
  );
}

export function createRenderer(init: RendererInit): Renderer {
  const tileSize = init.tileSize ?? DEFAULT_TILE_SIZE;
  const gridSize: GridSize = { cols: init.gridSize.cols, rows: init.gridSize.rows };
  const resolution =
    typeof window !== "undefined" && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;

  const app = new PIXI.Application({
    width: gridSize.cols * tileSize,
    height: gridSize.rows * tileSize,
    resolution,
    autoDensity: true,
    antialias: false,
    autoStart: false,
    backgroundAlpha: 0,
  });

  const view = app.view as HTMLCanvasElement;
  init.container.appendChild(view);

  const stage = app.stage;
  const gridLayer = new PIXI.Graphics();
  const oreLayer = new PIXI.Graphics();
  const hoverLayer = new PIXI.Graphics();

  stage.addChild(gridLayer);
  stage.addChild(oreLayer);
  stage.addChild(hoverLayer);

  let oreCoords: Coord[] = [];
  let hoverCoord: Coord | null = null;

  let oreDirty = true;
  let hoverDirty = true;

  drawGridLayer(gridLayer, tileSize, gridSize, resolution);

  const metrics: RendererMetrics = {
    tileSize,
    gridSize,
  };

  return {
    app,
    stage,
    metrics,
    setOre(ore: ReadonlyArray<Coord>): void {
      oreCoords = ore.filter((coord) => isInBounds(coord, gridSize));
      oreDirty = true;
    },
    setHover(coord: Coord | null): void {
      hoverCoord = coord !== null && isInBounds(coord, gridSize) ? coord : null;
      hoverDirty = true;
    },
    render(): void {
      if (oreDirty) {
        drawOreLayer(oreLayer, oreCoords, tileSize);
        oreDirty = false;
      }
      if (hoverDirty) {
        drawHoverLayer(hoverLayer, hoverCoord, tileSize, resolution);
        hoverDirty = false;
      }

      app.render();
    },
    getView(): HTMLCanvasElement {
      return view;
    },
    destroy(): void {
      if (view.parentElement === init.container) {
        init.container.removeChild(view);
      }
      app.destroy(true, { children: true });
    },
  };
}
