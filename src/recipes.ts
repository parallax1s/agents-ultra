export type Recipe = {
  input: string;
  output: string;
  timeMs: number;
};

export const IRON_ORE_TO_PLATE: Recipe = {
  input: 'iron-ore',
  output: 'iron-plate',
  timeMs: 1000,
};

export function getRecipeForInput(input: string): Recipe | undefined {
  return input === 'iron-ore' ? IRON_ORE_TO_PLATE : undefined;
}
