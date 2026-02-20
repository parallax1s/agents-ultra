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

    expect(furnace.canAcceptItem('iron-ore')).toBe(true);
    startCraft(furnace);

    const preBoundaryTicks = FURNACE_SMELT_TICKS - 1;
    const boundaryTicks = 1;

    runTicks(furnace, preBoundaryTicks);
    expect(furnace.canProvideItem('iron-plate')).toBe(false);

    runTicks(furnace, boundaryTicks);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);
  });

  it('holds blocked output deterministically, then resumes only after extraction at boundary', () => {
    const furnace = new Furnace();

    startCraft(furnace);
    runTicks(furnace, FURNACE_SMELT_TICKS);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);

    runTicks(furnace, FURNACE_SMELT_TICKS);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);
    expect(furnace.canAcceptItem('iron-ore')).toBe(false);

    runTicks(furnace, 1);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);
    expect(furnace.canAcceptItem('iron-ore')).toBe(false);
    expect(furnace.acceptItem('iron-ore')).toBe(false);

    expect(furnace.provideItem('iron-plate')).toBe('iron-plate');
    expect(furnace.provideItem('iron-plate')).toBeNull();
    expect(furnace.canAcceptItem('iron-ore')).toBe(true);
    expect(furnace.canProvideItem('iron-plate')).toBe(false);

    startCraft(furnace);
    runTicks(furnace, FURNACE_SMELT_TICKS - 1);
    expect(furnace.canProvideItem('iron-plate')).toBe(false);

    runTicks(furnace, 1);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);
  });

  it('does not craft when no input is present', () => {
    const furnace = new Furnace();

    runTicks(furnace, FURNACE_SMELT_TICKS * 3);

    expect(furnace.canProvideItem('iron-plate')).toBe(false);
    expect(furnace.provideItem('iron-plate')).toBeNull();
  });
});
