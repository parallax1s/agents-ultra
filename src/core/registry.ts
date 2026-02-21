import type { EntityBase, EntityKind } from './types';

export type RegisteredEntityKind = EntityKind | (string & {});
export const CANONICAL_TICK_PHASES = ["miner", "belt", "inserter", "furnace"] as const;
export type CanonicalTickPhase = (typeof CANONICAL_TICK_PHASES)[number];

export const SIM_TICK_CADENCE_MS = 1000 / 60;

export const CANONICAL_TICK_PHASE_CADENCE_TICKS = {
  miner: 60,
  belt: 15,
  inserter: 20,
  furnace: 180,
} as const satisfies Record<CanonicalTickPhase, number>;

const tickPhaseRank = CANONICAL_TICK_PHASES.reduce(
  (acc, phase, rank): Record<CanonicalTickPhase, number> => {
    acc[phase] = rank;
    return acc;
  },
  {} as Record<CanonicalTickPhase, number>,
);

type EntityDefinition = {
  create(init: any, sim: unknown): unknown;
  update(entity: EntityBase, dtMs: number, sim: unknown): void;
  tickPhase?: CanonicalTickPhase;
};

const registry = new Map<RegisteredEntityKind, EntityDefinition>();

export function registerEntity(kind: RegisteredEntityKind, def: EntityDefinition): void {
  if (registry.has(kind)) {
    throw new Error(`Entity kind "${String(kind)}" is already registered`);
  }

  registry.set(kind, def);
}

export function getDefinition(kind: RegisteredEntityKind): EntityDefinition | undefined {
  return registry.get(kind);
}

export function getTickPhaseRank(kind: RegisteredEntityKind): number | undefined {
  const phase = registry.get(kind)?.tickPhase;
  return phase === undefined ? undefined : tickPhaseRank[phase];
}

export function getCanonicalKindRank(kind: RegisteredEntityKind): number {
  const rank = getTickPhaseRank(kind);
  return rank === undefined ? CANONICAL_TICK_PHASES.length : rank;
}
