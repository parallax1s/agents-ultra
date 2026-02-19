import { describe, expect, it } from 'vitest';

import { Furnace } from '../src/entities/furnace';

describe('Furnace', () => {
  it('produces iron-plate after 1s when given one iron-ore', () => {
    const furnace = new Furnace();

    expect(furnace.canAcceptItem('iron-ore')).toBe(true);
    furnace.acceptItem('iron-ore');

    furnace.update(0);
    furnace.update(999);
    expect(furnace.canProvideItem('iron-plate')).toBe(false);

    furnace.update(1000);
    expect(furnace.canProvideItem('iron-plate')).toBe(true);
  });

  it('output blocks crafting when occupied', () => {
    const furnace = new Furnace();

    furnace.output = 'iron-plate';
    expect(furnace.canAcceptItem('iron-ore')).toBe(false);

    expect(furnace.provideItem('iron-plate')).toBe('iron-plate');
    expect(furnace.canAcceptItem('iron-ore')).toBe(true);

    furnace.acceptItem('iron-ore');
    furnace.update(0);
    furnace.update(1000);

    expect(furnace.canProvideItem('iron-plate')).toBe(true);
  });

  it('does not craft without input', () => {
    const furnace = new Furnace();

    furnace.update(0);
    furnace.update(2000);

    expect(furnace.canProvideItem('iron-plate')).toBe(false);
  });
});
