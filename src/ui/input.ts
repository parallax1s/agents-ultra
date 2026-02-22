export type GridCoord = { x: number; y: number };

export type InputMetrics = {
  tileSize: number;
  gridSize: {
    cols: number;
    rows: number;
  };
  viewport?: {
    width: number;
    height: number;
    offsetX?: number;
    offsetY?: number;
    scale?: number;
  };
};

type KeyEventName = "keydown";

type KeyEventLike = {
  code?: string;
  key?: string;
  repeat?: boolean;
  preventDefault?: () => void;
};

type PointerEventName = "pointermove" | "pointerdown";

type PointerEventLike = {
  global: {
    x: number;
    y: number;
  };
};

type PointerListener = (event: PointerEventLike) => void;

type KeyDownListener = (event: KeyEventLike) => void;

type Listener = PointerListener | KeyDownListener;

export type InputStage = {
  on(event: PointerEventName | KeyEventName, listener: Listener): unknown;
  off(event: PointerEventName | KeyEventName, listener: Listener): unknown;
};

export type AttachInputArgs = {
  app: unknown;
  stage: InputStage;
  metrics: InputMetrics;
};

export type InputController = {
  onHover(cb: (coord: GridCoord | null) => void): () => void;
  onClick(cb: (coord: GridCoord) => void): () => void;
  onRotate(cb: () => void): () => void;
  onPauseToggle(cb: () => void): () => void;
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

const toPositiveScale = (value: number | null | undefined, fallback: number): number => {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return value;
};

const toFiniteNumber = (value: number | null | undefined): number | null => {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }

  return value;
};

export const attachInput = ({ app, stage, metrics }: AttachInputArgs): InputController => {
  void app;

  const hoverCallbacks = new Set<(coord: GridCoord | null) => void>();
  const clickCallbacks = new Set<(coord: GridCoord) => void>();
  const rotateCallbacks = new Set<() => void>();
  const pauseToggleCallbacks = new Set<() => void>();

  const toGrid = (pt: { x: number; y: number }): GridCoord | null => {
    const { tileSize, gridSize } = metrics;
    const { cols, rows } = gridSize;
    const scale = toPositiveScale(toFiniteNumber(metrics.viewport?.scale), 1);
    const tileSpan = tileSize * scale;
    const offsetX = toFiniteNumber(metrics.viewport?.offsetX) ?? 0;
    const offsetY = toFiniteNumber(metrics.viewport?.offsetY) ?? 0;
    const viewportWidth = toFiniteNumber(metrics.viewport?.width);
    const viewportHeight = toFiniteNumber(metrics.viewport?.height);

    if (!Number.isFinite(tileSize) || tileSize <= 0 || cols <= 0 || rows <= 0 || tileSpan <= 0) {
      return null;
    }

    const localX = pt.x - offsetX;
    const localY = pt.y - offsetY;

    if (localX < 0 || localY < 0) {
      return null;
    }

    if (
      (typeof viewportWidth === "number" && localX > viewportWidth)
      || (typeof viewportHeight === "number" && localY > viewportHeight)
    ) {
      return null;
    }

    const gridX = Math.floor(localX / tileSpan);
    const gridY = Math.floor(localY / tileSpan);

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

  const isRotateKey = (event: KeyEventLike): boolean => (
    event.code === "KeyR" || event.key === "r" || event.key === "R"
  );

  const isPauseToggleKey = (event: KeyEventLike): boolean => (
    event.code === "Space" || event.key === " "
  );

  const handleKeyDown: KeyDownListener = (event) => {
    if (!isRotateKey(event) || event.repeat === true) {
      if (!isPauseToggleKey(event) || event.repeat === true) {
        return;
      }

      for (const callback of pauseToggleCallbacks) {
        callback();
      }

      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      return;
    }

    for (const callback of rotateCallbacks) {
      callback();
    }

    if (typeof event.preventDefault === "function") {
      event.preventDefault();
    }
  };

  stage.on("pointermove", handlePointerMove);
  stage.on("pointerdown", handlePointerDown);
  stage.on("keydown", handleKeyDown);

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

  const onRotate = (cb: () => void): (() => void) => {
    rotateCallbacks.add(cb);
    return () => {
      rotateCallbacks.delete(cb);
    };
  };

  const onPauseToggle = (cb: () => void): (() => void) => {
    pauseToggleCallbacks.add(cb);
    return () => {
      pauseToggleCallbacks.delete(cb);
    };
  };

  const destroy = (): void => {
    stage.off("pointermove", handlePointerMove);
    stage.off("pointerdown", handlePointerDown);
    stage.off("keydown", handleKeyDown);
    hoverCallbacks.clear();
    clickCallbacks.clear();
    rotateCallbacks.clear();
    pauseToggleCallbacks.clear();
  };

  return {
    onHover,
    onClick,
    onRotate,
    onPauseToggle,
    toGrid,
    destroy,
  };
};
