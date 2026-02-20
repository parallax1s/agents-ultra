import { expect, test } from "@playwright/test";

test.describe("Agents Ultra app smoke", () => {
  test("renders canvas and palette buttons", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: "Miner" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Belt" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Inserter" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Furnace" })).toBeVisible();
  });

  test("switches selected palette item via keyboard hotkeys", async ({ page }) => {
    await page.goto("/");

    const miner = page.getByRole("button", { name: "Miner" });
    const belt = page.getByRole("button", { name: "Belt" });

    await expect(miner).toHaveAttribute("data-active", "true");
    await page.keyboard.press("2");
    await expect(belt).toHaveAttribute("data-active", "true");
  });

  test("places an entity on click and stores it in runtime sim", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 640 });
    await page.goto("/");

    const miner = page.getByRole("button", { name: "Miner" });
    await miner.click();
    await expect(miner).toHaveAttribute("data-active", "true");

    const canvas = page.locator("canvas");
    const target = await page.evaluate<{
      found: boolean;
      tileX: number;
      tileY: number;
      x: number;
      y: number;
      reason: string;
    }>(() => {
      type PlacementSimulation = {
        width?: number;
        height?: number;
        tileSize?: number;
        getMap?: () => {
          isOre?: (x: number, y: number) => boolean;
        };
      };

      const sim = (window as unknown as { __SIM__?: PlacementSimulation }).__SIM__;
      const canvas = document.querySelector("canvas");
      if (!sim || typeof sim.getMap !== "function" || !canvas) {
        return {
          found: false,
          tileX: 0,
          tileY: 0,
          x: 0,
          y: 0,
          reason: "missing simulation map or canvas",
        };
      }

      const map = sim.getMap();
      if (!map || typeof map.isOre !== "function") {
        return {
          found: false,
          tileX: 0,
          tileY: 0,
          x: 0,
          y: 0,
          reason: "missing map isOre function",
        };
      }

      const width =
        typeof sim.width === "number" && Number.isInteger(sim.width) && sim.width > 0 ? sim.width : 60;
      const height =
        typeof sim.height === "number" && Number.isInteger(sim.height) && sim.height > 0 ? sim.height : 40;
      const tileSize =
        typeof sim.tileSize === "number" && Number.isInteger(sim.tileSize) && sim.tileSize > 0 ? sim.tileSize : 32;

      const rect = canvas.getBoundingClientRect();
      const worldW = width * tileSize;
      const worldH = height * tileSize;
      if (worldW <= 0 || worldH <= 0) {
        return {
          found: false,
          tileX: 0,
          tileY: 0,
          x: 0,
          y: 0,
          reason: "invalid simulation dimensions",
        };
      }

      const canvasWidth = canvas.width > 0 ? canvas.width : rect.width;
      const canvasHeight = canvas.height > 0 ? canvas.height : rect.height;
      const scale = Math.max(0.0001, Math.min(canvasWidth / worldW, canvasHeight / worldH));
      const tileSpan = tileSize * scale;
      const viewW = worldW * scale;
      const viewH = worldH * scale;
      const offsetX = Math.floor((canvasWidth - viewW) / 2);
      const offsetY = Math.floor((canvasHeight - viewH) / 2);

      for (let tileY = 0; tileY < height; tileY += 1) {
        for (let tileX = 2; tileX < width; tileX += 1) {
          if (map.isOre(tileX, tileY)) {
            const cx = offsetX + tileX * tileSpan + tileSpan / 2;
            const cy = offsetY + tileY * tileSpan + tileSpan / 2;

            if (cx < 0 || cy < 0 || cx >= rect.width || cy >= rect.height) {
              continue;
            }

            return {
              found: true,
              tileX,
              tileY,
              x: Math.round(cx),
              y: Math.round(cy),
              reason: "",
            };
          }
        }
      }

      return {
        found: false,
        tileX: 0,
        tileY: 0,
        x: 0,
        y: 0,
        reason: "no ore tile found in visible canvas area",
      };
    });

    expect(target.found).toBe(true);
    if (!target.found) {
      throw new Error(`Unable to find placement tile: ${target.reason}`);
    }

    const prePlacementState = await page.evaluate(() => {
      const sim = (
        window as unknown as {
          __SIM__?: {
            getPlacementSnapshot?: () => { tickCount: number; elapsedMs: number; tick: number; entityCount: number };
            tickCount?: number;
            getAllEntities?: () => unknown[];
          };
        }
      ).__SIM__;
      if (!sim) {
        return { tickCount: 0, entityCount: 0 };
      }

      if (typeof sim.getPlacementSnapshot === "function") {
        return sim.getPlacementSnapshot();
      }

      return {
        tickCount: typeof sim.tickCount === "number" ? sim.tickCount : 0,
        entityCount: typeof sim.getAllEntities === "function" ? sim.getAllEntities().length : 0,
        tick: 0,
        elapsedMs: 0,
      };
    });

    await canvas.click({ position: { x: target.x, y: target.y } });

    await page.waitForFunction(
      (
        baseline: { tickCount: number; entityCount: number } | null
      ): boolean => {
        const sim = (
          window as unknown as {
            __SIM__?: {
              getPlacementSnapshot?: () => { tickCount: number; entityCount: number };
              tickCount?: number;
              getAllEntities?: () => unknown[];
            };
          }
        ).__SIM__;

        if (!sim || baseline === null) {
          return false;
        }

        const state = typeof sim.getPlacementSnapshot === "function"
          ? sim.getPlacementSnapshot()
          : typeof sim.tickCount === "number" && typeof sim.getAllEntities === "function"
            ? {
                tickCount: sim.tickCount,
                entityCount: sim.getAllEntities().length,
              }
            : null;

        if (!state) {
          return false;
        }

        return state.entityCount > baseline.entityCount;
      },
      { tickCount: prePlacementState.tickCount, entityCount: prePlacementState.entityCount },
      {
        timeout: 5000,
      }
    );

    const finalCount = await page.evaluate(() => {
      const sim = (
        window as unknown as {
          __SIM__?: {
            getPlacementSnapshot?: () => { tickCount: number; entityCount: number };
            getAllEntities?: () => unknown[];
          };
        }
      ).__SIM__;
      if (!sim || typeof sim.getAllEntities !== "function") {
        return 0;
      }
      return sim.getAllEntities().length;
    });

    expect(finalCount).toBeGreaterThan(0);

    const tileHasEntity = await page.evaluate(
      (expected: { tileX: number; tileY: number }): boolean => {
        const sim = (
          window as unknown as {
            __SIM__?: {
              getAllEntities?: () => Array<{ pos?: { x?: number; y?: number } }>;
            };
          }
        ).__SIM__;
        if (!sim || typeof sim.getAllEntities !== "function") {
          return false;
        }

        return sim.getAllEntities().some((entity) => {
          if (typeof entity !== "object" || entity === null || !("pos" in entity)) {
            return false;
          }

          const pos = (entity as { pos?: { x?: number; y?: number } }).pos;
          if (pos === undefined || typeof pos.x !== "number" || typeof pos.y !== "number") {
            return false;
          }

          return pos.x === expected.tileX && pos.y === expected.tileY;
        });
      },
      { tileX: target.tileX, tileY: target.tileY },
    );

    expect(tileHasEntity).toBe(true);
  });
});
