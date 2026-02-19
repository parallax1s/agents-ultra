import { Furnace, FURNACE_TYPE } from './furnace';

export const entities: Record<string, { create: () => Furnace }> = {
  [FURNACE_TYPE]: { create: () => new Furnace() },
};

export const isRegistered = (type: string): boolean => type in entities;
