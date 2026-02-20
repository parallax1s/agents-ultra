export interface GridCoord {
  x: number;
  y: number;
}

export type TileType = "empty" | "iron-ore";

export type Direction = 'N' | 'E' | 'S' | 'W';

export const DIRECTION_SEQUENCE = ["N", "E", "S", "W"] as const;

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

export type EntityKind = 'resource' | 'miner' | 'belt' | 'inserter' | 'furnace' | 'chest';

export interface EntityBase {
  id: string;
  kind: EntityKind;
  pos: GridCoord;
  rot: Direction;
  state?: unknown;
}
