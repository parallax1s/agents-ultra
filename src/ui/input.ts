export type GridCoord = { x: number; y: number };

export type InputMetrics = {
  tileSize: number;
  gridSize: {
    cols: number;
    rows: number;
  };
};

type PointerEventName = "pointermove" | "pointerdown";

type PointerEventLike = {
  global: {
    x: number;
    y: number;
  };
};

type PointerListener = (event: PointerEventLike) => void;

export type InputStage = {
  on(event: PointerEventName, listener: PointerListener): unknown;
  off(event: PointerEventName, listener: PointerListener): unknown;
};

export type AttachInputArgs = {
  app: unknown;
  stage: InputStage;
  metrics: InputMetrics;
};

export type InputController = {
  onHover(cb: (coord: GridCoord | null) => void): () => void;
  onClick(cb: (coord: GridCoord) => void): () => void;
  toGrid(pt: { x: number; y: number }): GridCoord | null;
  destroy(): void;
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
};

export const attachInput = ({ app, stage, metrics }: AttachInputArgs): InputController => {
  void app;

  const hoverCallbacks = new Set<(coord: GridCoord | null) => void>();
  const clickCallbacks = new Set<(coord: GridCoord) => void>();

  const toGrid = (pt: { x: number; y: number }): GridCoord | null => {
    const { tileSize, gridSize } = metrics;
    const { cols, rows } = gridSize;

    if (!Number.isFinite(tileSize) || tileSize <= 0 || cols <= 0 || rows <= 0) {
      return null;
    }

    const gridX = Math.floor(pt.x / tileSize);
    const gridY = Math.floor(pt.y / tileSize);

    if (gridX < 0 || gridY < 0 || gridX >= cols || gridY >= rows) {
      return null;
    }

    return {
      x: clamp(gridX, 0, cols - 1),
      y: clamp(gridY, 0, rows - 1),
    };
  };

  const handlePointerMove: PointerListener = (event) => {
    const coord = toGrid(event.global);
    for (const callback of hoverCallbacks) {
      callback(coord);
    }
  };

  const handlePointerDown: PointerListener = (event) => {
    const coord = toGrid(event.global);
    if (coord === null) {
      return;
    }

    for (const callback of clickCallbacks) {
      callback(coord);
    }
  };

  stage.on("pointermove", handlePointerMove);
  stage.on("pointerdown", handlePointerDown);

  const onHover = (cb: (coord: GridCoord | null) => void): (() => void) => {
    hoverCallbacks.add(cb);
    return () => {
      hoverCallbacks.delete(cb);
    };
  };

  const onClick = (cb: (coord: GridCoord) => void): (() => void) => {
    clickCallbacks.add(cb);
    return () => {
      clickCallbacks.delete(cb);
    };
  };

  const destroy = (): void => {
    stage.off("pointermove", handlePointerMove);
    stage.off("pointerdown", handlePointerDown);
    hoverCallbacks.clear();
    clickCallbacks.clear();
  };

  return {
    onHover,
    onClick,
    toGrid,
    destroy,
  };
};
