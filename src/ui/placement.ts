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

export type PlacementAction = "place" | "remove";

export type PlacementFeedbackToken =
  | "placed"
  | "removed"
  | "select-kind"
  | "pick-tile"
  | "blocked-occupied"
  | "blocked-out-of-bounds"
  | "blocked-resource-required"
  | "blocked-resource"
  | "blocked-empty"
  | "blocked-invalid-target"
  | "blocked";

export type PlacementFeedback = {
  action: PlacementAction;
  ok: boolean;
  reason: string;
  token: PlacementFeedbackToken;
  message: string;
};

/**
 * Canonical list of all placeable entity kinds.
 */
export const ALL_ENTITY_KINDS: EntityKind[] = ['Miner', 'Belt', 'Inserter', 'Furnace'];

export type CoreActionOutcome = {
  ok?: boolean;
  success?: boolean;
  allowed?: boolean;
  reason?: string;
  reasonCode?: string;
  code?: string;
  status?: string;
};

/**
 * Simulation contract consumed by the placement controller.
 */
export interface Simulation {
  /** Optional outcome-first placement probe from core map/rules. */
  getPlacementOutcome?(kind: EntityKind, tile: Tile, rotation: Rotation): CoreActionOutcome | boolean;

  /** Alias for outcome-first placement probe. */
  previewPlacement?(kind: EntityKind, tile: Tile, rotation: Rotation): CoreActionOutcome | boolean;

  /** Outcome-first placement mutation from core map/rules. */
  placeEntity?(kind: EntityKind, tile: Tile, rotation: Rotation): CoreActionOutcome | boolean;

  /** Alias for outcome-first placement mutation. */
  tryPlace?(kind: EntityKind, tile: Tile, rotation: Rotation): CoreActionOutcome | boolean;

  /** Outcome-first remove mutation from core map/rules. */
  removeAt?(tile: Tile): CoreActionOutcome | boolean;

  /** Alias for outcome-first remove mutation. */
  tryRemove?(tile: Tile): CoreActionOutcome | boolean;

  /** Returns whether the given entity can be placed at `tile` with `rotation`. */
  canPlace(kind: EntityKind, tile: Tile, rotation: Rotation): boolean;

  /** Adds an entity to the simulation. */
  addEntity(kind: EntityKind, tile: Tile, rotation: Rotation): void | CoreActionOutcome | boolean;

  /** Removes any entity at `tile`. */
  removeEntity(tile: Tile): void | CoreActionOutcome | boolean;

  /** Returns whether a tile can be removed at `tile` (e.g., not a resource node). */
  canRemove?(tile: Tile): boolean;

  /** Returns whether an entity currently occupies `tile`. */
  hasEntityAt?(tile: Tile): boolean;

  /** Returns whether `tile` is a resource tile that cannot be removed directly. */
  isResourceTile?(tile: Tile): boolean;

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
  feedback: PlacementFeedback | null;
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
  clickLMB(): PlacementFeedback;

  /** Handles a right-click removal action. */
  clickRMB(): PlacementFeedback;

  /** Returns the ghost preview model for rendering. */
  getGhost(): GhostPreview;
}

type InternalState = {
  selectedKind: EntityKind | null;
  rotation: Rotation;
  cursor: Tile | null;
  canPlace: boolean;
  feedback: PlacementFeedback | null;
};

type GridBounds = {
  cols: number;
  rows: number;
};

function inBounds(tile: Tile, bounds: GridBounds): boolean {
  return tile.x >= 0 && tile.y >= 0 && tile.x < bounds.cols && tile.y < bounds.rows;
}

function getGridBounds(sim: Simulation, opts?: { cols?: number; rows?: number }): GridBounds | null {
  if (opts?.cols !== undefined && opts?.rows !== undefined && Number.isInteger(opts.cols) && opts.cols > 0 && Number.isInteger(opts.rows) && opts.rows > 0) {
    return { cols: opts.cols, rows: opts.rows };
  }

  const width = (sim as { width?: unknown }).width;
  const height = (sim as { height?: unknown }).height;
  if (
    typeof width === "number" && Number.isInteger(width) && width > 0
    && typeof height === "number" && Number.isInteger(height) && height > 0
  ) {
    return { cols: width, rows: height };
  }

  return null;
}

function cloneTile(tile: Tile): Tile {
  return { x: tile.x, y: tile.y };
}

function nextRotation(rotation: Rotation): Rotation {
  return ((rotation + 1) % 4) as Rotation;
}

type NormalizedOutcome = {
  ok: boolean;
  reason: string;
};

const PLACEMENT_FEEDBACK_BY_REASON: Readonly<Record<string, { token: PlacementFeedbackToken; message: string }>> = {
  ok: { token: "placed", message: "Placed" },
  placed: { token: "placed", message: "Placed" },
  removed: { token: "removed", message: "Removed" },
  occupied: { token: "blocked-occupied", message: "Tile occupied" },
  tile_occupied: { token: "blocked-occupied", message: "Tile occupied" },
  out_of_bounds: { token: "blocked-out-of-bounds", message: "Out of bounds" },
  outside_bounds: { token: "blocked-out-of-bounds", message: "Out of bounds" },
  needs_resource: { token: "blocked-resource-required", message: "Needs ore tile" },
  requires_resource: { token: "blocked-resource-required", message: "Needs ore tile" },
  requires_ore: { token: "blocked-resource-required", message: "Needs ore tile" },
  no_resource: { token: "blocked-resource-required", message: "Needs ore tile" },
  not_on_resource: { token: "blocked-resource-required", message: "Needs ore tile" },
  resource_tile: { token: "blocked-resource", message: "Resource locked" },
  cannot_remove_resource: { token: "blocked-resource", message: "Resource locked" },
  no_entity: { token: "blocked-empty", message: "Nothing here" },
  empty_tile: { token: "blocked-empty", message: "Nothing here" },
  nothing_to_remove: { token: "blocked-empty", message: "Nothing here" },
  invalid_target: { token: "blocked-invalid-target", message: "Invalid tile" },
  no_cursor: { token: "pick-tile", message: "Pick a tile" },
  no_selection: { token: "select-kind", message: "Select a building" },
  blocked: { token: "blocked", message: "Blocked" },
  cannot_place: { token: "blocked", message: "Blocked" },
  cannot_remove: { token: "blocked", message: "Blocked" },
  failed: { token: "blocked", message: "Blocked" },
  rejected: { token: "blocked", message: "Blocked" },
};

function normalizeReasonCode(reason: unknown): string | null {
  if (typeof reason !== "string") {
    return null;
  }

  const normalized = reason.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  return normalized.replace(/[\s-]+/g, "_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeOutcome(
  rawOutcome: unknown,
  fallbackReasonWhenOk: string,
): NormalizedOutcome | null {
  if (typeof rawOutcome === "boolean") {
    return {
      ok: rawOutcome,
      reason: rawOutcome ? fallbackReasonWhenOk : "blocked",
    };
  }

  if (!isRecord(rawOutcome)) {
    return null;
  }

  const reason =
    normalizeReasonCode(rawOutcome.reason)
    ?? normalizeReasonCode(rawOutcome.reasonCode)
    ?? normalizeReasonCode(rawOutcome.code)
    ?? normalizeReasonCode(rawOutcome.status);

  const explicitOk = [rawOutcome.ok, rawOutcome.success, rawOutcome.allowed]
    .find((value) => typeof value === "boolean");

  if (typeof explicitOk === "boolean") {
    return {
      ok: explicitOk,
      reason: reason ?? (explicitOk ? fallbackReasonWhenOk : "blocked"),
    };
  }

  if (reason === "ok" || reason === "success" || reason === "placed" || reason === "removed" || reason === "allowed") {
    return { ok: true, reason };
  }

  if (reason !== null) {
    return { ok: false, reason };
  }

  return null;
}

function resolveFeedbackFromReason(
  action: PlacementAction,
  reason: string,
  ok: boolean,
): { token: PlacementFeedbackToken; message: string } {
  const fromReason = PLACEMENT_FEEDBACK_BY_REASON[reason];
  if (fromReason !== undefined) {
    if (ok && action === "remove" && fromReason.token === "placed") {
      return { token: "removed", message: "Removed" };
    }

    if (ok && action === "place" && fromReason.token === "removed") {
      return { token: "placed", message: "Placed" };
    }

    return fromReason;
  }

  if (ok) {
    return action === "place"
      ? { token: "placed", message: "Placed" }
      : { token: "removed", message: "Removed" };
  }

  return { token: "blocked", message: "Blocked" };
}

export function outcomeToFeedback(action: PlacementAction, outcome: NormalizedOutcome): PlacementFeedback {
  const reason = normalizeReasonCode(outcome.reason) ?? (outcome.ok ? (action === "place" ? "placed" : "removed") : "blocked");
  const translated = resolveFeedbackFromReason(action, reason, outcome.ok);

  return {
    action,
    ok: outcome.ok,
    reason,
    token: translated.token,
    message: translated.message,
  };
}

function getPlacementPreviewOutcome(
  sim: Simulation,
  kind: EntityKind,
  tile: Tile,
  rotation: Rotation,
): NormalizedOutcome | null {
  if (typeof sim.getPlacementOutcome === "function") {
    return normalizeOutcome(sim.getPlacementOutcome(kind, tile, rotation), "placed");
  }

  if (typeof sim.previewPlacement === "function") {
    return normalizeOutcome(sim.previewPlacement(kind, tile, rotation), "placed");
  }

  return null;
}

function getPlacementAttemptOutcome(
  sim: Simulation,
  kind: EntityKind,
  tile: Tile,
  rotation: Rotation,
  wasPreviewPlaceable: boolean,
): NormalizedOutcome {
  if (typeof sim.placeEntity === "function") {
    const outcome = normalizeOutcome(sim.placeEntity(kind, tile, rotation), "placed");
    if (outcome !== null) {
      return outcome;
    }
  }

  if (typeof sim.tryPlace === "function") {
    const outcome = normalizeOutcome(sim.tryPlace(kind, tile, rotation), "placed");
    if (outcome !== null) {
      return outcome;
    }
  }

  if (typeof sim.addEntity !== "function") {
    return { ok: false, reason: "blocked" };
  }

  const hadEntityBefore = sim.hasEntityAt?.(tile);
  const rawOutcome = sim.addEntity(kind, tile, rotation);
  const normalized = normalizeOutcome(rawOutcome, "placed");
  if (normalized !== null) {
    return normalized;
  }

  const hasEntityAfter = sim.hasEntityAt?.(tile);
  if (hadEntityBefore === false && hasEntityAfter === true) {
    return { ok: true, reason: "placed" };
  }

  if (hadEntityBefore === true && hasEntityAfter === true) {
    return { ok: false, reason: "occupied" };
  }

  if (wasPreviewPlaceable) {
    return { ok: true, reason: "placed" };
  }

  return { ok: false, reason: "blocked" };
}

function getRemovalAttemptOutcome(
  sim: Simulation,
  tile: Tile,
): NormalizedOutcome {
  if (typeof sim.removeAt === "function") {
    const outcome = normalizeOutcome(sim.removeAt(tile), "removed");
    if (outcome !== null) {
      return outcome;
    }
  }

  if (typeof sim.tryRemove === "function") {
    const outcome = normalizeOutcome(sim.tryRemove(tile), "removed");
    if (outcome !== null) {
      return outcome;
    }
  }

  if (typeof sim.removeEntity !== "function") {
    return { ok: false, reason: "blocked" };
  }

  const hadEntityBefore = sim.hasEntityAt?.(tile);
  const rawOutcome = sim.removeEntity(tile);
  const normalized = normalizeOutcome(rawOutcome, "removed");
  if (normalized !== null) {
    return normalized;
  }

  const hasEntityAfter = sim.hasEntityAt?.(tile);
  if (hadEntityBefore === true && hasEntityAfter === false) {
    return { ok: true, reason: "removed" };
  }

  if (hadEntityBefore === false) {
    return { ok: false, reason: "no_entity" };
  }

  return { ok: true, reason: "removed" };
}

function canPreviewPlacement(
  sim: Simulation,
  kind: EntityKind,
  tile: Tile,
  rotation: Rotation,
): boolean {
  const previewOutcome = getPlacementPreviewOutcome(sim, kind, tile, rotation);
  if (previewOutcome !== null) {
    return previewOutcome.ok;
  }

  if (typeof sim.canPlace === "function") {
    return sim.canPlace(kind, tile, rotation);
  }

  return false;
}

/**
 * Creates a placement controller that owns selection/cursor state and delegates world mutation to `sim`.
 */
export function createPlacementController(
  sim: Simulation,
  opts?: { initialKind?: EntityKind; initialRotation?: Rotation; cols?: number; rows?: number },
): PlacementController {
  const bounds = getGridBounds(sim, opts);
  const state: InternalState = {
    selectedKind: opts?.initialKind ?? null,
    rotation: opts?.initialRotation ?? 0,
    cursor: null,
    canPlace: false,
    feedback: null,
  };

  const recomputeCanPlace = (): void => {
    if (state.selectedKind === null || state.cursor === null) {
      state.canPlace = false;
      return;
    }

    if (bounds !== null && !inBounds(state.cursor, bounds)) {
      state.canPlace = false;
      return;
    }

    state.canPlace = canPreviewPlacement(sim, state.selectedKind, state.cursor, state.rotation);
  };

  return {
    getState(): PlacementState {
      return {
        selectedKind: state.selectedKind,
        rotation: state.rotation,
        cursor: state.cursor === null ? null : cloneTile(state.cursor),
        canPlace: state.canPlace,
        feedback: state.feedback === null ? null : { ...state.feedback },
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
      if (tile === null || (bounds !== null && !inBounds(tile, bounds))) {
        state.cursor = null;
        state.canPlace = false;
        state.feedback = null;
        return;
      }

      state.cursor = cloneTile(tile);
      recomputeCanPlace();
    },

    clickLMB(): PlacementFeedback {
      if (state.selectedKind === null) {
        state.feedback = outcomeToFeedback("place", { ok: false, reason: "no_selection" });
        return state.feedback;
      }

      if (state.cursor === null) {
        state.feedback = outcomeToFeedback("place", { ok: false, reason: "no_cursor" });
        return state.feedback;
      }

      const outcome = getPlacementAttemptOutcome(sim, state.selectedKind, state.cursor, state.rotation, state.canPlace);
      state.feedback = outcomeToFeedback("place", outcome);
      recomputeCanPlace();
      return state.feedback;
    },

    clickRMB(): PlacementFeedback {
      if (state.cursor === null) {
        state.feedback = outcomeToFeedback("remove", { ok: false, reason: "no_cursor" });
        return state.feedback;
      }

      const outcome = getRemovalAttemptOutcome(sim, state.cursor);
      state.feedback = outcomeToFeedback("remove", outcome);
      recomputeCanPlace();
      return state.feedback;
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
