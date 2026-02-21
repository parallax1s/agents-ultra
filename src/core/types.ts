export interface GridCoord {
  x: number;
  y: number;
}

export type TileType = "empty" | "iron-ore";

export type Direction = 'N' | 'E' | 'S' | 'W';

export const DIRECTION_SEQUENCE = ["N", "E", "S", "W"] as const;

export const DIRECTION_VECTORS: Readonly<Record<Direction, GridCoord>> = {
  N: { x: 0, y: -1 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
  W: { x: -1, y: 0 },
};

export const OPPOSITE_DIRECTION: Readonly<Record<Direction, Direction>> = {
  N: "S",
  E: "W",
  S: "N",
  W: "E",
};

export const rotateDirection = (direction: Direction, steps = 1): Direction => {
  const directionIndex: Record<Direction, number> = {
    N: 0,
    E: 1,
    S: 2,
    W: 3,
  };

  const normalizedSteps = ((steps % 4) + 4) % 4;
  const index = (directionIndex[direction] + normalizedSteps) % 4;
  return DIRECTION_SEQUENCE[index] as Direction;
};

export type ItemKind = 'iron-ore' | 'iron-plate';

export const SLICE_ITEM_KINDS = ['iron-ore', 'iron-plate'] as const satisfies readonly ItemKind[];

export const FURNACE_INPUT_ITEM = 'iron-ore' as const;
export const FURNACE_OUTPUT_ITEM = 'iron-plate' as const;

export const isItemKind = (value: string): value is ItemKind =>
  (SLICE_ITEM_KINDS as readonly string[]).includes(value);

export type EntityKind = 'resource' | 'miner' | 'belt' | 'inserter' | 'furnace' | 'chest';

export interface EntityBase {
  id: string;
  kind: EntityKind;
  pos: GridCoord;
  rot: Direction;
  state?: unknown;
}

export const STARTUP_PROBE_PHASES = [
  "init",
  "sim-ready",
  "renderer-ready",
  "input-ready",
  "running",
  "error",
] as const;

export type StartupProbePhase = (typeof STARTUP_PROBE_PHASES)[number];

export type StartupProbeState = Readonly<{
  phase: StartupProbePhase;
  error?: string;
}>;
