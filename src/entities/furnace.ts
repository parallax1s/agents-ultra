import { getRecipeForInput } from '../recipes';
import { isItemKind } from '../core/types';

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
      isItemKind(item) &&
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
    return isItemKind(item) && item === 'iron-plate' && this.output === 'iron-plate';
  }

  provideItem(item: string): string | null {
    if (!this.canProvideItem(item)) {
      return null;
    }

    const provided = this.output;
    this.output = null;
    return provided;
  }

  private tryStartCrafting(): void {
    if (this.crafting || this.input === null || this.output !== null) {
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
  }

  private hasReachedCompletionBoundary(): boolean {
    return this.smeltProgressTicks >= FURNACE_SMELT_TICKS;
  }

  private resetCraftingState(): void {
    this.crafting = false;
    this.smeltProgressTicks = 0;
    this.recipeOutput = null;
  }

  update(_nowMs: number = 0): void {
    if (!this.crafting) {
      if (this.output !== null) {
        return;
      }

      this.tryStartCrafting();
      return;
    }

    this.smeltProgressTicks = Math.min(this.smeltProgressTicks + 1, FURNACE_SMELT_TICKS);

    if (!this.hasReachedCompletionBoundary()) {
      return;
    }

    if (this.output !== null) {
      return;
    }

    const completedOutput = this.recipeOutput;
    this.resetCraftingState();
    if (completedOutput === null) {
      return;
    }

    this.output = completedOutput;
  }

  get inputOccupied(): boolean {
    return this.input !== null;
  }

  get outputOccupied(): boolean {
    return this.output !== null;
  }

  get progress01(): number {
    if (this.output !== null) {
      return 1;
    }

    if (!this.crafting) {
      return 0;
    }

    return this.smeltProgressTicks / FURNACE_SMELT_TICKS;
  }
}
