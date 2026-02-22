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

export function getRecipeForInput(input: string): Recipe | undefined {
  if (!isItemKind(input)) {
    return undefined;
  }

  return input === 'iron-ore' ? IRON_ORE_TO_PLATE : undefined;
}
