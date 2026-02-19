export interface GridCoord {
  x: number;
  y: number;
}

export type Direction = 'N' | 'E' | 'S' | 'W';

export type ItemKind = 'iron-ore' | 'iron-plate';

export type EntityKind = 'resource' | 'miner' | 'belt' | 'inserter' | 'furnace' | 'chest';

export interface EntityBase {
  id: string;
  kind: EntityKind;
  pos: GridCoord;
  rot: Direction;
  state?: unknown;
}
