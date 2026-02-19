/**
 * Supported buildable entity kinds for placement.
 */
export type EntityKind = 'Miner' | 'Belt' | 'Inserter' | 'Furnace';

/**
 * Quarter-turn clockwise rotations.
 * `0` is the default orientation, then `1`, `2`, `3`.
 */
export type Rotation = 0 | 1 | 2 | 3;

/**
 * Integer tile coordinates in world/grid space.
 */
export type Tile = {
  x: number;
  y: number;
};

/**
 * Read model for renderer ghost placement preview.
 */
export type GhostPreview = {
  tile: Tile | null;
  kind: EntityKind | null;
  rotation: Rotation;
  valid: boolean;
};

/**
 * Canonical list of all placeable entity kinds.
 */
export const ALL_ENTITY_KINDS: EntityKind[] = ['Miner', 'Belt', 'Inserter', 'Furnace'];

/**
 * Simulation contract consumed by the placement controller.
 */
export interface Simulation {
  /** Returns whether the given entity can be placed at `tile` with `rotation`. */
  canPlace(kind: EntityKind, tile: Tile, rotation: Rotation): boolean;

  /** Adds an entity to the simulation. */
  addEntity(kind: EntityKind, tile: Tile, rotation: Rotation): void;

  /** Removes any entity at `tile`. */
  removeEntity(tile: Tile): void;

  /** Optional simulation pause toggle. */
  togglePause?(): void;
}

/**
 * Immutable snapshot of placement input state.
 */
export type PlacementState = {
  selectedKind: EntityKind | null;
  rotation: Rotation;
  cursor: Tile | null;
  canPlace: boolean;
};

/**
 * Framework-agnostic placement input controller API.
 */
export interface PlacementController {
  /** Returns the current placement state snapshot. */
  getState(): PlacementState;

  /** Selects an entity kind for placement. */
  selectKind(kind: EntityKind): void;

  /** Rotates the selected placement orientation by 90 degrees clockwise. */
  rotate(): void;

  /** Sets or clears the cursor tile and recomputes placement validity. */
  setCursor(tile: Tile | null): void;

  /** Handles a left-click placement attempt. */
  clickLMB(): void;

  /** Handles a right-click removal action. */
  clickRMB(): void;

  /** Returns the ghost preview model for rendering. */
  getGhost(): GhostPreview;
}

type InternalState = {
  selectedKind: EntityKind | null;
  rotation: Rotation;
  cursor: Tile | null;
  canPlace: boolean;
};

function cloneTile(tile: Tile): Tile {
  return { x: tile.x, y: tile.y };
}

function nextRotation(rotation: Rotation): Rotation {
  return ((rotation + 1) % 4) as Rotation;
}

/**
 * Creates a placement controller that owns selection/cursor state and delegates world mutation to `sim`.
 */
export function createPlacementController(
  sim: Simulation,
  opts?: { initialKind?: EntityKind; initialRotation?: Rotation },
): PlacementController {
  const state: InternalState = {
    selectedKind: opts?.initialKind ?? null,
    rotation: opts?.initialRotation ?? 0,
    cursor: null,
    canPlace: false,
  };

  const recomputeCanPlace = (): void => {
    if (state.selectedKind === null || state.cursor === null) {
      state.canPlace = false;
      return;
    }

    state.canPlace = sim.canPlace(state.selectedKind, state.cursor, state.rotation);
  };

  return {
    getState(): PlacementState {
      return {
        selectedKind: state.selectedKind,
        rotation: state.rotation,
        cursor: state.cursor === null ? null : cloneTile(state.cursor),
        canPlace: state.canPlace,
      };
    },

    selectKind(kind: EntityKind): void {
      state.selectedKind = kind;
      recomputeCanPlace();
    },

    rotate(): void {
      state.rotation = nextRotation(state.rotation);
      recomputeCanPlace();
    },

    setCursor(tile: Tile | null): void {
      state.cursor = tile === null ? null : cloneTile(tile);
      recomputeCanPlace();
    },

    clickLMB(): void {
      if (state.selectedKind === null || state.cursor === null || !state.canPlace) {
        return;
      }

      sim.addEntity(state.selectedKind, state.cursor, state.rotation);
      recomputeCanPlace();
    },

    clickRMB(): void {
      if (state.cursor === null) {
        return;
      }

      sim.removeEntity(state.cursor);
      recomputeCanPlace();
    },

    getGhost(): GhostPreview {
      return {
        tile: state.cursor === null ? null : cloneTile(state.cursor),
        kind: state.selectedKind,
        rotation: state.rotation,
        valid: state.canPlace,
      };
    },
  };
}
