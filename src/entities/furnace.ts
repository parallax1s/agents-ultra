import { getRecipeForInput } from '../recipes';

export const FURNACE_TYPE = 'furnace';

export class Furnace {
  input: string | null = null;
  output: string | null = null;
  private crafting = false;
  private completeAtMs?: number;

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

  update(nowMs: number = Date.now()): void {
    if (!this.crafting && this.input === 'iron-ore' && this.output === null) {
      getRecipeForInput(this.input);
      this.crafting = true;
      this.completeAtMs = nowMs + 1000;
      this.input = null;
      return;
    }

    if (
      this.crafting &&
      this.completeAtMs !== undefined &&
      nowMs >= this.completeAtMs &&
      this.output === null
    ) {
      this.output = 'iron-plate';
      this.crafting = false;
      this.completeAtMs = undefined;
    }
  }
}
