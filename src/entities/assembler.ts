import { getRecipeForInput, type Recipe } from "../recipes";
import { isItemKind, type ItemKind } from "../core/types";

export const ASSEMBLER_TYPE = "assembler";

const ASSEMBLER_DEFAULT_TICK_TIME_MS = 180;

type RecipeState = Recipe & {
  ticks: number;
  elapsedTicks: number;
};

export type AssemblerPowerHooks = {
  onStart?: () => boolean;
  onTick?: () => boolean;
};

export class Assembler {
  input: ItemKind | null = null;
  output: ItemKind | null = null;
  private crafting = false;
  private recipe: RecipeState | null = null;
  private powerHooks: AssemblerPowerHooks | null = null;

  setPowerHooks(hooks: AssemblerPowerHooks | null): void {
    this.powerHooks = hooks;
  }

  private getTicksForRecipe(recipe: Recipe): number {
    const fallbackTicks = Math.max(1, Math.floor(recipe.timeMs));
    return recipe.timeMs <= 0
      ? ASSEMBLER_DEFAULT_TICK_TIME_MS
      : fallbackTicks;
  }

  canAcceptItem(item: string): boolean {
    if (!isItemKind(item)) {
      return false;
    }

    if (this.output !== null || this.input !== null || this.crafting) {
      return false;
    }

    return getRecipeForInput(item) !== undefined;
  }

  acceptItem(item: string): boolean {
    if (!this.canAcceptItem(item)) {
      return false;
    }

    this.input = item as ItemKind;
    return true;
  }

  canProvideItem(item: string): boolean {
    return isItemKind(item) && item === this.output;
  }

  provideItem(item: string): ItemKind | null {
    if (!this.canProvideItem(item) || this.output === null) {
      return null;
    }

    const provided = this.output;
    this.output = null;
    return provided;
  }

  private canStartCrafting(): boolean {
    if (this.input === null || this.output !== null || this.crafting) {
      return false;
    }

    const recipe = getRecipeForInput(this.input);
    if (recipe === undefined) {
      return false;
    }

    return true;
  }

  private startCrafting(): boolean {
    if (!this.canStartCrafting()) {
      return false;
    }

    const recipe = getRecipeForInput(this.input);
    if (recipe === undefined) {
      return false;
    }

    if (this.powerHooks?.onStart !== undefined && this.powerHooks.onStart() !== true) {
      return false;
    }

    this.recipe = {
      ...recipe,
      ticks: this.getTicksForRecipe(recipe),
      elapsedTicks: 0,
    };

    this.crafting = true;
    this.input = null;
    return true;
  }

  private resetCraftingState(): void {
    this.recipe = null;
    this.crafting = false;
  }

  private isComplete(): boolean {
    const recipe = this.recipe;
    if (recipe === null) {
      return false;
    }
    return recipe.elapsedTicks >= recipe.ticks;
  }

  update(_nowMs = 0): void {
    if (!this.crafting) {
      if (!this.output || this.output === null) {
        this.startCrafting();
      }
      return;
    }

    if (this.powerHooks?.onTick !== undefined && this.powerHooks.onTick() !== true) {
      return;
    }

    if (this.recipe !== null) {
      this.recipe.elapsedTicks += 1;
      if (this.isComplete() && this.recipe.elapsedTicks >= this.recipe.ticks) {
        this.output = this.recipe.output;
        this.resetCraftingState();
      }
    }
  }

  get progress01(): number {
    if (!this.crafting || this.recipe === null) {
      if (this.output !== null) {
        return 1;
      }
      return 0;
    }

    if (this.recipe.ticks <= 0) {
      return 1;
    }

    return Math.max(0, Math.min(1, this.recipe.elapsedTicks / this.recipe.ticks));
  }

  get inputOccupied(): boolean {
    return this.input !== null;
  }

  get outputOccupied(): boolean {
    return this.output !== null;
  }
}
