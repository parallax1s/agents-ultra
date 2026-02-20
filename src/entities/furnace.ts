import { getRecipeForInput } from '../recipes';

export const FURNACE_TYPE = 'furnace';
const FURNACE_SMELT_TICKS = 180;

export class Furnace {
  input: string | null = null;
  output: string | null = null;
  private crafting = false;
  private recipeOutput: string | null = null;
  private smeltProgressTicks = 0;

  canAcceptItem(item: string): boolean {
    return (
      getRecipeForInput(item) !== undefined &&
      this.input === null &&
      !this.crafting &&
      this.output === null
    );
  }

  acceptItem(item: string): boolean {
    if (!this.canAcceptItem(item)) {
      return false;
    }

    this.input = item;
    return true;
  }

  canProvideItem(item: string): boolean {
    return item === 'iron-plate' && this.output === 'iron-plate';
  }

  provideItem(item: string): string | null {
    if (!this.canProvideItem(item)) {
      return null;
    }

    const provided = this.output;
    this.output = null;
    return provided;
  }

  update(_nowMs: number = 0): void {
    if (!this.crafting) {
      if (this.input === null || this.output !== null) {
        return;
      }

      const recipe = getRecipeForInput(this.input);
      if (recipe === undefined) {
        return;
      }

      this.recipeOutput = recipe.output;
      this.crafting = true;
      this.smeltProgressTicks = 0;
      this.input = null;
      return;
    }

    if (this.output !== null) {
      return;
    }

    if (this.smeltProgressTicks < FURNACE_SMELT_TICKS) {
      this.smeltProgressTicks += 1;
    }

    if (this.smeltProgressTicks < FURNACE_SMELT_TICKS) {
      return;
    }

    this.output = this.recipeOutput ?? null;
    this.crafting = false;
    this.smeltProgressTicks = 0;
    this.recipeOutput = null;
  }

  get inputOccupied(): boolean {
    return this.input !== null;
  }

  get outputOccupied(): boolean {
    return this.output !== null;
  }

  get progress01(): number {
    if (!this.crafting) {
      return 0;
    }

    return this.smeltProgressTicks / FURNACE_SMELT_TICKS;
  }
}
