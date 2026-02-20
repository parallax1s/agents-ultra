import type { EntityBase, EntityKind } from './types';

export type RegisteredEntityKind = EntityKind | (string & {});

type EntityDefinition = {
  create(init: any, sim: unknown): unknown;
  update(entity: EntityBase, dtMs: number, sim: unknown): void;
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
