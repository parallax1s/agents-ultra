import type { EntityBase, EntityKind } from './types';

export type RegisteredEntityKind = EntityKind | (string & {});
export const CANONICAL_TICK_PHASES = ["miner", "belt", "furnace", "inserter"] as const;
export type CanonicalTickPhase = (typeof CANONICAL_TICK_PHASES)[number];

const tickPhaseRank: Record<CanonicalTickPhase, number> = {
  miner: 0,
  belt: 1,
  furnace: 2,
  inserter: 3,
};

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
