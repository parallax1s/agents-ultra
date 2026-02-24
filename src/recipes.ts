import { isItemKind, type ItemKind } from './core/types';

export type Recipe = {
  input: ItemKind;
  output: ItemKind;
  timeMs: number;
};

export const IRON_ORE_TO_PLATE: Recipe = {
  input: 'iron-ore',
  output: 'iron-plate',
  timeMs: 180,
};

export const IRON_PLATE_TO_GEAR: Recipe = {
  input: 'iron-plate',
  output: 'iron-gear',
  timeMs: 220,
};

export function getRecipeForInput(input: string): Recipe | undefined {
  if (!isItemKind(input)) {
    return undefined;
  }

  if (input === 'iron-ore') {
    return IRON_ORE_TO_PLATE;
  }

  if (input === 'iron-plate') {
    return IRON_PLATE_TO_GEAR;
  }

  return undefined;
}
