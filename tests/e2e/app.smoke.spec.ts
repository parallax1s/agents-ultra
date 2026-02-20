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
    await page.goto("/");

    const miner = page.getByRole("button", { name: "Miner" });
    await miner.click();
    await expect(miner).toHaveAttribute("data-active", "true");

    const canvas = page.locator("canvas");
    const target = await page.evaluate<{
      found: boolean;
      x: number;
      y: number;
      reason: string;
    }>(() => {
      type PlacementSimulation = {
        width?: number;
        height?: number;
        getMap?: () => {
          isOre?: (x: number, y: number) => boolean;
        };
      };

      const sim = (window as unknown as { __SIM__?: PlacementSimulation }).__SIM__;
      const canvas = document.querySelector("canvas");
      if (!sim || typeof sim.getMap !== "function" || !canvas) {
        return { found: false, x: 0, y: 0, reason: "missing simulation map or canvas" };
      }

      const map = sim.getMap();
      if (!map || typeof map.isOre !== "function") {
        return { found: false, x: 0, y: 0, reason: "missing map isOre function" };
      }

      const width =
        typeof sim.width === "number" && Number.isInteger(sim.width) && sim.width > 0 ? sim.width : 60;
      const height =
        typeof sim.height === "number" && Number.isInteger(sim.height) && sim.height > 0 ? sim.height : 40;

      const rect = canvas.getBoundingClientRect();
      const maxTileX = Math.max(0, Math.floor(rect.width / 32) - 1);
      const maxTileY = Math.max(0, Math.floor(rect.height / 32) - 1);

      for (let tileY = 0; tileY < height && tileY <= maxTileY; tileY += 1) {
        for (let tileX = 0; tileX < width && tileX <= maxTileX; tileX += 1) {
          if (map.isOre(tileX, tileY)) {
            return { found: true, x: tileX * 32 + 16, y: tileY * 32 + 16, reason: "" };
          }
        }
      }

      return { found: false, x: 0, y: 0, reason: "no ore tile found in visible canvas area" };
    });

    expect(target.found).toBe(true);
    if (!target.found) {
      throw new Error(`Unable to find placement tile: ${target.reason}`);
    }

    await canvas.click({ position: { x: target.x, y: target.y } });

    const entityCount = await page.evaluate(() => {
      const sim = (window as unknown as { __SIM__?: { getAllEntities?: () => unknown[] } }).__SIM__;
      if (!sim || typeof sim.getAllEntities !== "function") {
        return 0;
      }
      return sim.getAllEntities().length;
    });

    expect(entityCount).toBeGreaterThan(0);
  });
});
