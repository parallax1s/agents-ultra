import { FURNACE_INPUT_ITEM, FURNACE_OUTPUT_ITEM, isItemKind } from '../core/types';

export const FURNACE_TYPE = 'furnace';
const FURNACE_SMELT_TICKS = 180;

export class Furnace {
  input: string | null = null;
  output: string | null = null;
  private crafting = false;
  private smeltProgressTicks = 0;

  canAcceptItem(item: string): boolean {
    return (
      isItemKind(item) &&
      item === FURNACE_INPUT_ITEM &&
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
    return isItemKind(item) && item === FURNACE_OUTPUT_ITEM && this.output === FURNACE_OUTPUT_ITEM;
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

    if (this.input !== FURNACE_INPUT_ITEM) {
      return;
    }

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

    this.resetCraftingState();
    this.output = FURNACE_OUTPUT_ITEM;
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
