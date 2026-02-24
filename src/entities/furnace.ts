import {
  FURNACE_INPUT_ITEM,
  FURNACE_OUTPUT_ITEM,
  isItemKind,
  type ItemKind,
} from "../core/types";

export const FURNACE_TYPE = 'furnace';
const FURNACE_SMELT_TICKS = 180;
const FURNACE_FUEL_CAPACITY = 1;
const FURNACE_FUEL_ITEMS = new Set<ItemKind>(["coal", "wood"] as const);

export type FurnacePowerHooks = {
  onStart?: () => boolean;
  onTick?: () => boolean;
  onFuelBurn?: (fuelAmount: number) => void;
};

export class Furnace {
  input: ItemKind | null = null;
  private fuelAmount: number = 0;
  output: ItemKind | null = null;
  private crafting = false;
  private smeltProgressTicks = 0;
  private powerHooks: FurnacePowerHooks | null = null;

  setPowerHooks(hooks: FurnacePowerHooks | null): void {
    this.powerHooks = hooks;
  }

  private canStartCrafting(): boolean {
    return this.input === FURNACE_INPUT_ITEM && !this.crafting && this.output === null;
  }

  canAcceptItem(item: string): boolean {
    if (FURNACE_FUEL_ITEMS.has(item as ItemKind)) {
      return this.fuelAmount < FURNACE_FUEL_CAPACITY;
    }

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

    if (FURNACE_FUEL_ITEMS.has(item as ItemKind)) {
      this.fuelAmount += 1;
      return true;
    }

    this.input = item as ItemKind;
    return true;
  }

  canConsumeFuelForStart(): boolean {
    return this.fuelAmount > 0;
  }

  private notifyFuelConsumed(): void {
    this.fuelAmount = Math.max(0, this.fuelAmount - 1);
    if (this.powerHooks?.onFuelBurn !== undefined) {
      this.powerHooks.onFuelBurn(1);
    }
  }

  canProvideItem(item: string): boolean {
    if (item === FURNACE_OUTPUT_ITEM) {
      return isItemKind(item) && this.output === FURNACE_OUTPUT_ITEM;
    }

    if (FURNACE_FUEL_ITEMS.has(item as ItemKind)) {
      return (
        this.fuelAmount > 0 &&
        !this.crafting &&
        this.output === null
      );
    }

    return false;
  }

  provideItem(item: string): ItemKind | null {
    if (!this.canProvideItem(item)) {
      return null;
    }

    if (FURNACE_FUEL_ITEMS.has(item as ItemKind)) {
      this.fuelAmount = Math.max(0, this.fuelAmount - 1);
      return item as ItemKind;
    }

    const provided = this.output;
    this.output = null;
    return provided;
  }

  startCrafting(): boolean {
    if (!this.canStartCrafting() || !this.canConsumeFuelForStart()) {
      return false;
    }

    if (this.powerHooks?.onStart !== undefined && this.powerHooks.onStart() !== true) {
      return false;
    }

    this.notifyFuelConsumed();
    this.crafting = true;
    this.smeltProgressTicks = 0;
    this.input = null;
    return true;
  }

  private hasReachedCompletionBoundary(): boolean {
    return this.smeltProgressTicks >= FURNACE_SMELT_TICKS;
  }

  private resetCraftingState(): void {
    this.crafting = false;
    this.smeltProgressTicks = 0;
  }

  update(_nowMs: number = 0, hooks: FurnacePowerHooks = {}): void {
    this.powerHooks = hooks;

    if (!this.crafting) {
      if (this.output !== null) {
        return;
      }

      this.startCrafting();
      return;
    }

    if (this.powerHooks.onTick !== undefined && this.powerHooks.onTick() !== true) {
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

  get storage(): number {
    return this.fuelAmount;
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
