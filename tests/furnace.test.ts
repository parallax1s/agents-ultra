import { describe, expect, it } from 'vitest';

import { Furnace } from '../src/entities/furnace';

const FURNACE_SMELT_TICKS = 180;

const startCraft = (furnace: Furnace): void => {
  expect(furnace.acceptItem('iron-ore')).toBe(true);
  furnace.update(0);
};

const runTicks = (furnace: Furnace, ticks: number): void => {
  for (let i = 0; i < ticks; i += 1) {
    furnace.update(0);
  }
};

describe('Furnace', () => {
  it('produces iron-plate on the exact 180th crafting tick boundary', () => {
    const furnace = new Furnace();
    let tick = 0;

    const advanceTo = (target: number): void => {
      if (target < tick) {
        throw new Error(`advanceTo target ${target} is before current tick ${tick}`);
      }
      runTicks(furnace, target - tick);
      tick = target;
    };

    expect(furnace.canAcceptItem('iron-ore')).toBe(true);
    startCraft(furnace);
    tick += 1;

    const preBoundaryTick = FURNACE_SMELT_TICKS;
    const boundaryTick = FURNACE_SMELT_TICKS + 1;
    advanceTo(preBoundaryTick);
    expect(tick).toBe(preBoundaryTick);
    expect(furnace.canProvideItem('iron-plate')).toBe(false);

    advanceTo(boundaryTick);
    expect(tick).toBe(boundaryTick);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);
  });

  it('holds blocked output deterministically, then resumes only after extraction at boundary', () => {
    const furnace = new Furnace();
    let tick = 0;

    const advanceTo = (target: number): void => {
      if (target < tick) {
        throw new Error(`advanceTo target ${target} is before current tick ${tick}`);
      }
      runTicks(furnace, target - tick);
      tick = target;
    };

    startCraft(furnace);
    tick += 1;

    const firstCompletion = FURNACE_SMELT_TICKS + 1;
    const secondCompletion = firstCompletion + FURNACE_SMELT_TICKS;

    advanceTo(firstCompletion);
    expect(tick).toBe(firstCompletion);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);

    advanceTo(secondCompletion);
    expect(tick).toBe(secondCompletion);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);
    expect(furnace.canAcceptItem('iron-ore')).toBe(false);

    advanceTo(secondCompletion + 1);
    expect(tick).toBe(secondCompletion + 1);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);
    expect(furnace.canAcceptItem('iron-ore')).toBe(false);
    expect(furnace.acceptItem('iron-ore')).toBe(false);

    expect(furnace.provideItem('iron-plate')).toBe('iron-plate');
    expect(furnace.provideItem('iron-plate')).toBeNull();
    expect(furnace.canAcceptItem('iron-ore')).toBe(true);
    expect(furnace.canProvideItem('iron-plate')).toBe(false);

    startCraft(furnace);
    tick += 1;

    const unblockBoundary = tick + FURNACE_SMELT_TICKS;
    advanceTo(unblockBoundary - 1);
    expect(tick).toBe(unblockBoundary - 1);
    expect(furnace.canProvideItem('iron-plate')).toBe(false);

    advanceTo(unblockBoundary);
    expect(tick).toBe(unblockBoundary);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);
  });

  it('does not craft when no input is present', () => {
    const furnace = new Furnace();

    runTicks(furnace, FURNACE_SMELT_TICKS * 3);

    expect(furnace.canProvideItem('iron-plate')).toBe(false);
    expect(furnace.provideItem('iron-plate')).toBeNull();
  });
});
