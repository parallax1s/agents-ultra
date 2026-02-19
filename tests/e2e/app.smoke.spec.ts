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

    await page.keyboard.press("2");
    const canvas = page.locator("canvas");
    await canvas.click({ position: { x: 120, y: 120 } });

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
