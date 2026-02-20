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

type FurnaceReplayFrame = {
  label: string;
  tick: number;
  input: string | null;
  output: string | null;
  canAccept: boolean;
  canProvide: boolean;
};

type FurnaceReplayRun = {
  frames: FurnaceReplayFrame[];
  firstProvide: string | null;
  secondProvide: string | null;
};

const runFurnaceReplay = (): FurnaceReplayRun => {
  const furnace = new Furnace();
  let tick = 0;
  const frames: FurnaceReplayFrame[] = [];
  const capture = (label: string): void => {
    frames.push({
      label,
      tick,
      input: furnace.input,
      output: furnace.output,
      canAccept: furnace.canAcceptItem('iron-ore'),
      canProvide: furnace.canProvideItem('iron-plate'),
    });
  };

  const advanceTo = (target: number): void => {
    if (target < tick) {
      throw new Error(`advanceTo target ${target} is before current tick ${tick}`);
    }
    runTicks(furnace, target - tick);
    tick = target;
  };

  capture('initial');

  expect(furnace.canAcceptItem('iron-ore')).toBe(true);
  startCraft(furnace);
  tick += 1;
  capture('first-load');

  advanceTo(180);
  capture('first-pre-completion');
  expect(furnace.canProvideItem('iron-plate')).toBe(false);

  advanceTo(181);
  capture('first-completion');
  expect(furnace.canProvideItem('iron-plate')).toBe(true);
  expect(furnace.canAcceptItem('iron-ore')).toBe(false);

  advanceTo(361);
  capture('first-output-held');
  expect(furnace.canProvideItem('iron-plate')).toBe(true);
  expect(furnace.canAcceptItem('iron-ore')).toBe(false);

  const firstProvide = furnace.provideItem('iron-plate');
  capture('first-output-extracted');
  expect(firstProvide).toBe('iron-plate');
  expect(furnace.canAcceptItem('iron-ore')).toBe(true);

  startCraft(furnace);
  tick += 1;
  capture('second-load');
  expect(furnace.canAcceptItem('iron-ore')).toBe(false);

  advanceTo(541);
  capture('second-pre-completion');
  expect(furnace.canProvideItem('iron-plate')).toBe(false);

  advanceTo(542);
  capture('second-completion');
  expect(furnace.canProvideItem('iron-plate')).toBe(true);

  const secondProvide = furnace.provideItem('iron-plate');
  capture('second-output-extracted');
  expect(secondProvide).toBe('iron-plate');

  return { frames, firstProvide, secondProvide };
};

describe('Furnace', () => {
  it('produces iron-plate on exact smelt completion boundaries', () => {
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

    advanceTo(boundaryTick + 1);
    expect(tick).toBe(boundaryTick + 1);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);
  });

  it('replays deterministic furnace phase behavior for blocked outputs and restart timing', () => {
    const first = runFurnaceReplay();
    const second = runFurnaceReplay();

    expect(first).toEqual(second);
    expect(first.frames).toEqual([
      {
        label: 'initial',
        tick: 0,
        input: null,
        output: null,
        canAccept: true,
        canProvide: false,
      },
      {
        label: 'first-load',
        tick: 1,
        input: null,
        output: null,
        canAccept: false,
        canProvide: false,
      },
      {
        label: 'first-pre-completion',
        tick: 180,
        input: null,
        output: null,
        canAccept: false,
        canProvide: false,
      },
      {
        label: 'first-completion',
        tick: 181,
        input: null,
        output: 'iron-plate',
        canAccept: false,
        canProvide: true,
      },
      {
        label: 'first-output-held',
        tick: 361,
        input: null,
        output: 'iron-plate',
        canAccept: false,
        canProvide: true,
      },
      {
        label: 'first-output-extracted',
        tick: 361,
        input: null,
        output: null,
        canAccept: true,
        canProvide: false,
      },
      {
        label: 'second-load',
        tick: 362,
        input: null,
        output: null,
        canAccept: false,
        canProvide: false,
      },
      {
        label: 'second-pre-completion',
        tick: 541,
        input: null,
        output: null,
        canAccept: false,
        canProvide: false,
      },
      {
        label: 'second-completion',
        tick: 542,
        input: null,
        output: 'iron-plate',
        canAccept: false,
        canProvide: true,
      },
      {
        label: 'second-output-extracted',
        tick: 542,
        input: null,
        output: null,
        canAccept: true,
        canProvide: false,
      },
    ]);

    expect(first.firstProvide).toBe('iron-plate');
    expect(first.secondProvide).toBe('iron-plate');
  });

  it('holds blocked output deterministically, then resumes only after extraction at the next boundary', () => {
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
    const lastBlockedProgress = firstCompletion + FURNACE_SMELT_TICKS - 1;

    advanceTo(firstCompletion);
    expect(tick).toBe(firstCompletion);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);

    advanceTo(lastBlockedProgress);
    expect(tick).toBe(lastBlockedProgress);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);
    expect(furnace.canAcceptItem('iron-ore')).toBe(false);
    expect(furnace.acceptItem('iron-ore')).toBe(false);

    advanceTo(firstCompletion + FURNACE_SMELT_TICKS);
    expect(tick).toBe(firstCompletion + FURNACE_SMELT_TICKS);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);
    expect(furnace.canAcceptItem('iron-ore')).toBe(false);
    expect(furnace.acceptItem('iron-ore')).toBe(false);

    expect(furnace.canAcceptItem('iron-ore')).toBe(false);

    expect(furnace.provideItem('iron-plate')).toBe('iron-plate');
    expect(furnace.provideItem('iron-plate')).toBeNull();
    expect(furnace.canAcceptItem('iron-ore')).toBe(true);
    expect(furnace.canProvideItem('iron-plate')).toBe(false);

    startCraft(furnace);
    tick += 1;

    const secondPreBoundary = tick + FURNACE_SMELT_TICKS - 1;
    const secondBoundary = tick + FURNACE_SMELT_TICKS;
    advanceTo(secondPreBoundary);
    expect(tick).toBe(secondPreBoundary);
    expect(furnace.canProvideItem('iron-plate')).toBe(false);
    expect(furnace.canAcceptItem('iron-ore')).toBe(false);

    advanceTo(secondBoundary);
    expect(tick).toBe(secondBoundary);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);
  });

  it('does not craft when no input is present', () => {
    const furnace = new Furnace();

    runTicks(furnace, FURNACE_SMELT_TICKS * 3);

    expect(furnace.canProvideItem('iron-plate')).toBe(false);
    expect(furnace.provideItem('iron-plate')).toBeNull();
  });
});
