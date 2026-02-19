import type { EntityBase, EntityKind } from './types';

type EntityDefinition = {
  create(init: any, sim: unknown): { state?: unknown } | void;
  update(entity: EntityBase, dtMs: number, sim: unknown): void;
};

const registry = new Map<EntityKind, EntityDefinition>();

export function registerEntity(kind: EntityKind, def: EntityDefinition): void {
  if (registry.has(kind)) {
    throw new Error(`Entity kind "${String(kind)}" is already registered`);
  }

  registry.set(kind, def);
}

export function getDefinition(kind: EntityKind): EntityDefinition | undefined {
  return registry.get(kind);
}
