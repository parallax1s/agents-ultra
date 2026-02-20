import { getRecipeForInput } from '../recipes';

export const FURNACE_TYPE = 'furnace';
const FURNACE_SMELT_TICKS = 180;

export class Furnace {
  input: string | null = null;
  output: string | null = null;
  private crafting = false;
  private smeltProgressTicks = 0;

  canAcceptItem(item: string): boolean {
    return (
      item === 'iron-ore' &&
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
    if (!this.crafting && this.input === 'iron-ore' && this.output === null) {
      const recipe = getRecipeForInput(this.input);
      if (recipe === undefined) {
        return;
      }

      this.crafting = true;
      this.smeltProgressTicks = 0;
      this.input = null;
      return;
    }

    if (!this.crafting) {
      return;
    }

    if (this.smeltProgressTicks < FURNACE_SMELT_TICKS) {
      this.smeltProgressTicks += 1;
    }

    if (this.smeltProgressTicks < FURNACE_SMELT_TICKS || this.output !== null) {
      return;
    }

    this.output = 'iron-plate';
    this.crafting = false;
    this.smeltProgressTicks = 0;
  }
}
