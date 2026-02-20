import { Furnace, FURNACE_TYPE } from './furnace';

export const MINER_ATTEMPT_TICKS = 60;
export const BELT_ATTEMPT_TICKS = 15;
export const INSERTER_ATTEMPT_TICKS = 20;

const isBoundaryTick = (tick: number, interval: number): boolean => {
  return tick > 0 && tick % interval === 0;
};

export const hasElapsedBoundaryTick = (tick: number, interval: 15 | 20 | 60): boolean => {
  return isBoundaryTick(tick, interval);
};

export const entities: Record<string, { create: () => Furnace }> = {
  [FURNACE_TYPE]: { create: () => new Furnace() },
};

export const isRegistered = (type: string): boolean => Object.hasOwn(entities, type);
