import { expect, test, type Page } from "@playwright/test";

type TileCandidate = {
  found: boolean;
  tileX: number;
  tileY: number;
  reason: string;
};

const waitForAppReady = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/");

  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Miner" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Belt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inserter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Furnace" })).toBeVisible();

  await expect
    .poll(async () =>
      page.evaluate(() => {
        const sim = (window as { __SIM__?: unknown }).__SIM__;
        if (!sim || typeof sim !== "object") {
          return false;
        }

        const runtime = sim as {
          width?: unknown;
          height?: unknown;
          tileSize?: unknown;
          canPlace?: unknown;
          getPlacementSnapshot?: unknown;
          getAllEntities?: unknown;
        };

        return (
          typeof runtime.width === "number" &&
          typeof runtime.height === "number" &&
          typeof runtime.tileSize === "number" &&
          typeof runtime.canPlace === "function" &&
          typeof runtime.getPlacementSnapshot === "function" &&
          typeof runtime.getAllEntities === "function"
        );
      }),
    )
    .toBe(true);
};

const readEntityCount = async (page: Page): Promise<number> => {
  const count = await page.evaluate(() => {
    type RuntimeSimulation = {
      getPlacementSnapshot?: () => { entityCount?: number };
      getAllEntities?: () => unknown;
    };

    const sim = (window as { __SIM__?: unknown }).__SIM__;
    if (!sim || typeof sim !== "object") {
      return null;
    }

    const runtime = sim as RuntimeSimulation;
    const snapshot = typeof runtime.getPlacementSnapshot === "function" ? runtime.getPlacementSnapshot() : null;
    if (typeof snapshot?.entityCount === "number") {
      return snapshot.entityCount;
    }

    const entities = typeof runtime.getAllEntities === "function" ? runtime.getAllEntities() : [];
    return Array.isArray(entities) ? entities.length : null;
  });

  if (typeof count !== "number") {
    throw new Error("Unable to read entity count from simulation");
  }

  return count;
};

const waitForEntityCount = async (page: Page, expectedCount: number): Promise<void> => {
  await expect.poll(async () => readEntityCount(page)).toBe(expectedCount);
};

const readTickCount = async (page: Page): Promise<number> => {
  const tickCount = await page.evaluate(() => {
    type RuntimeSimulation = {
      getPlacementSnapshot?: () => { tickCount?: number };
      tickCount?: unknown;
    };

    const sim = (window as { __SIM__?: unknown }).__SIM__;
    if (!sim || typeof sim !== "object") {
      return null;
    }

    const runtime = sim as RuntimeSimulation;
    const snapshot = typeof runtime.getPlacementSnapshot === "function" ? runtime.getPlacementSnapshot() : null;
    if (typeof snapshot?.tickCount === "number") {
      return snapshot.tickCount;
    }

    return typeof runtime.tickCount === "number" ? runtime.tickCount : null;
  });

  if (typeof tickCount !== "number") {
    throw new Error("Unable to read tick count from simulation");
  }

  return tickCount;
};

const findResourceTile = async (page: Page): Promise<{ tileX: number; tileY: number }> => {
  const tile = await page.evaluate(() => {
    type RuntimeMap = {
      isOre?: (x: number, y: number) => boolean;
    };
    type RuntimeSimulation = {
      width?: unknown;
      height?: unknown;
      getMap?: () => RuntimeMap;
    };

    const sim = (window as { __SIM__?: unknown }).__SIM__;
    if (!sim || typeof sim !== "object") {
      return null;
    }

    const runtime = sim as RuntimeSimulation;
    if (typeof runtime.getMap !== "function") {
      return null;
    }
    const map = runtime.getMap();
    if (!map || typeof map.isOre !== "function") {
      return null;
    }

    const width =
      typeof runtime.width === "number" && Number.isInteger(runtime.width) && runtime.width > 0 ? runtime.width : 60;
    const height =
      typeof runtime.height === "number" && Number.isInteger(runtime.height) && runtime.height > 0 ? runtime.height : 40;

    for (let tileY = 0; tileY < height; tileY += 1) {
      for (let tileX = 0; tileX < width; tileX += 1) {
        if (map.isOre(tileX, tileY)) {
          return { tileX, tileY };
        }
      }
    }

    return null;
  });

  if (!tile) {
    throw new Error("Unable to find an ore/resource tile");
  }

  return tile;
};

const findPlaceableBeltTile = async (
  page: Page,
  excludeTiles: readonly { x: number; y: number }[] = [],
): Promise<{ tileX: number; tileY: number }> => {
  const candidate = await page.evaluate(
    ({ excludeTiles }) => {
      type PlacementSimulation = {
        width?: unknown;
        height?: unknown;
        tileSize?: unknown;
        canPlace?: (kind: "Belt", tile: { x: number; y: number }, rotation: number) => boolean;
      };

      const sim = (window as { __SIM__?: unknown }).__SIM__;
      const canvas = document.querySelector("canvas");
      if (!sim || typeof sim !== "object" || !canvas || typeof (sim as { canPlace?: unknown }).canPlace !== "function") {
        return {
          found: false,
          tileX: 0,
          tileY: 0,
          reason: "simulation not ready",
        } satisfies TileCandidate;
      }

      const runtime = sim as PlacementSimulation;
      const width =
        typeof runtime.width === "number" && runtime.width > 0 && Number.isInteger(runtime.width) ? runtime.width : 60;
      const height =
        typeof runtime.height === "number" && runtime.height > 0 && Number.isInteger(runtime.height) ? runtime.height : 40;
      const tileSize =
        typeof runtime.tileSize === "number" && runtime.tileSize > 0 && Number.isInteger(runtime.tileSize)
          ? runtime.tileSize
          : 32;

      const rect = canvas.getBoundingClientRect();
      const worldW = width * tileSize;
      const worldH = height * tileSize;
      const canvasWidth = canvas.width > 0 ? canvas.width : rect.width;
      const canvasHeight = canvas.height > 0 ? canvas.height : rect.height;
      const scale = Math.max(0.0001, Math.min(canvasWidth / worldW, canvasHeight / worldH));
      const tileSpan = tileSize * scale;
      const viewW = worldW * scale;
      const viewH = worldH * scale;
      const offsetX = Math.floor((canvasWidth - viewW) / 2);
      const offsetY = Math.floor((canvasHeight - viewH) / 2);

      for (let tileY = 0; tileY < height; tileY += 1) {
        for (let tileX = 0; tileX < width; tileX += 1) {
          if (
            excludeTiles.some((excluded) => {
              return excluded.x === tileX && excluded.y === tileY;
            })
          ) {
            continue;
          }

          if (!runtime.canPlace?.("Belt", { x: tileX, y: tileY }, 0)) {
            continue;
          }

          const cx = offsetX + tileX * tileSpan + tileSpan / 2;
          const cy = offsetY + tileY * tileSpan + tileSpan / 2;
          if (cx < 0 || cy < 0 || cx >= rect.width || cy >= rect.height) {
            continue;
          }

          return {
            found: true,
            tileX,
            tileY,
            reason: "",
          } satisfies TileCandidate;
        }
      }

      return {
        found: false,
        tileX: 0,
        tileY: 0,
        reason: "no valid placement tile found in viewport",
      } satisfies TileCandidate;
    },
    { excludeTiles },
  );

  if (!candidate.found) {
    throw new Error(`Unable to find placeable belt tile: ${candidate.reason}`);
  }

  return { tileX: candidate.tileX, tileY: candidate.tileY };
};

const tileToCanvasPoint = async (page: Page, tileX: number, tileY: number): Promise<{ x: number; y: number }> => {
  const point = await page.evaluate(
    ({ tileX, tileY }) => {
      type PlacementSimulation = {
        width?: unknown;
        height?: unknown;
        tileSize?: unknown;
      };

      const canvas = document.querySelector("canvas");
      if (!canvas) {
        return { found: false, x: 0, y: 0, reason: "canvas not ready" };
      }

      const sim = (window as { __SIM__?: unknown }).__SIM__;
      if (!sim || typeof sim !== "object") {
        return { found: false, x: 0, y: 0, reason: "simulation not ready" };
      }

      const runtime = sim as PlacementSimulation;
      const width =
        typeof runtime.width === "number" && Number.isInteger(runtime.width) && runtime.width > 0 ? runtime.width : 60;
      const height =
        typeof runtime.height === "number" && Number.isInteger(runtime.height) && runtime.height > 0 ? runtime.height : 40;
      const tileSize =
        typeof runtime.tileSize === "number" && Number.isInteger(runtime.tileSize) && runtime.tileSize > 0
          ? runtime.tileSize
          : 32;

      if (!Number.isInteger(tileX) || !Number.isInteger(tileY) || tileX < 0 || tileY < 0 || tileX >= width || tileY >= height) {
        return { found: false, x: 0, y: 0, reason: "invalid tile" };
      }

      const rect = canvas.getBoundingClientRect();
      const worldW = width * tileSize;
      const worldH = height * tileSize;
      const canvasWidth = canvas.width > 0 ? canvas.width : rect.width;
      const canvasHeight = canvas.height > 0 ? canvas.height : rect.height;
      const scale = Math.max(0.0001, Math.min(canvasWidth / worldW, canvasHeight / worldH));
      const tileSpan = tileSize * scale;
      const viewW = worldW * scale;
      const viewH = worldH * scale;
      const offsetX = Math.floor((canvasWidth - viewW) / 2);
      const offsetY = Math.floor((canvasHeight - viewH) / 2);
      const cx = offsetX + tileX * tileSpan + tileSpan / 2;
      const cy = offsetY + tileY * tileSpan + tileSpan / 2;

      if (cx < 0 || cy < 0 || cx >= rect.width || cy >= rect.height) {
        return { found: false, x: 0, y: 0, reason: "tile outside viewport" };
      }

      return { found: true, x: Math.round(cx), y: Math.round(cy), reason: "" };
    },
    { tileX, tileY },
  );

  if (!point.found) {
    throw new Error(`Tile (${tileX}, ${tileY}) is not visible in canvas: ${point.reason}`);
  }

  return { x: point.x, y: point.y };
};

const clickTile = async (
  page: Page,
  tileX: number,
  tileY: number,
  button: "left" | "right" = "left",
): Promise<void> => {
  const canvas = page.locator("canvas");
  const point = await tileToCanvasPoint(page, tileX, tileY);
  await canvas.click({ position: point, button });
};

test.describe("placement feedback e2e", () => {
  test("honors compact control contract for selection, rotation, resource removal, and pause toggle", async ({ page }) => {
    await waitForAppReady(page);

    const hudTool = page.getByTestId("hud-tool-value");
    const hudRotation = page.getByTestId("hud-rotation-value");
    const hudPause = page.getByTestId("hud-pause-value");
    const status = page.getByRole("status");

    await page.keyboard.press("Digit1");
    await expect(hudTool).toHaveAttribute("data-value", "Miner");
    await page.keyboard.press("Digit2");
    await expect(hudTool).toHaveAttribute("data-value", "Belt");
    await page.keyboard.press("Digit3");
    await expect(hudTool).toHaveAttribute("data-value", "Inserter");
    await page.keyboard.press("Digit4");
    await expect(hudTool).toHaveAttribute("data-value", "Furnace");

    await expect(hudRotation).toHaveAttribute("data-value", "N");
    await page.keyboard.press("KeyR");
    await expect(hudRotation).toHaveAttribute("data-value", "E");
    await page.keyboard.press("KeyR");
    await expect(hudRotation).toHaveAttribute("data-value", "S");
    await page.keyboard.press("KeyR");
    await expect(hudRotation).toHaveAttribute("data-value", "W");
    await page.keyboard.press("KeyR");
    await expect(hudRotation).toHaveAttribute("data-value", "N");

    await page.keyboard.press("Digit2");
    const startEntityCount = await readEntityCount(page);
    const placedTile = await findPlaceableBeltTile(page);
    await clickTile(page, placedTile.tileX, placedTile.tileY, "left");
    await waitForEntityCount(page, startEntityCount + 1);

    const resourceTile = await findResourceTile(page);
    await clickTile(page, resourceTile.tileX, resourceTile.tileY, "right");
    await expect(status).toHaveText(`Nothing to remove at (${resourceTile.tileX}, ${resourceTile.tileY}).`);
    await waitForEntityCount(page, startEntityCount + 1);

    const beforePauseTick = await readTickCount(page);
    const beforePauseTool = await hudTool.getAttribute("data-value");
    const beforePauseRotation = await hudRotation.getAttribute("data-value");
    await page.keyboard.press("Space");
    await expect(hudPause).toHaveAttribute("data-value", "paused");

    await page.waitForTimeout(140);
    const pausedTickOne = await readTickCount(page);
    await page.waitForTimeout(140);
    const pausedTickTwo = await readTickCount(page);
    expect(pausedTickTwo).toBe(pausedTickOne);
    expect(pausedTickOne).toBeGreaterThanOrEqual(beforePauseTick);
    expect(await hudTool.getAttribute("data-value")).toBe(beforePauseTool);
    expect(await hudRotation.getAttribute("data-value")).toBe(beforePauseRotation);
    await waitForEntityCount(page, startEntityCount + 1);

    await page.keyboard.press("Space");
    await expect(hudPause).toHaveAttribute("data-value", "running");
    await expect.poll(async () => readTickCount(page)).toBeGreaterThan(pausedTickTwo);
    await waitForEntityCount(page, startEntityCount + 1);
  });

  test("shows rejected feedback and clears it after valid placement and removal actions", async ({ page }) => {
    await waitForAppReady(page);
    await page.keyboard.press("Digit2");

    const baseEntityCount = await readEntityCount(page);
    const firstTile = await findPlaceableBeltTile(page);

    await clickTile(page, firstTile.tileX, firstTile.tileY, "left");
    await waitForEntityCount(page, baseEntityCount + 1);
    const status = page.getByRole("status");
    await expect(status).toHaveText(`Placed Belt at (${firstTile.tileX}, ${firstTile.tileY}).`);

    await clickTile(page, firstTile.tileX, firstTile.tileY, "left");
    const blockedPlacementMessage = `Placement blocked for Belt at (${firstTile.tileX}, ${firstTile.tileY}).`;
    await expect(status).toHaveText(blockedPlacementMessage);

    const secondTile = await findPlaceableBeltTile(page, [{ x: firstTile.tileX, y: firstTile.tileY }]);
    await clickTile(page, secondTile.tileX, secondTile.tileY, "left");
    await waitForEntityCount(page, baseEntityCount + 2);
    await expect(status).toHaveText(`Placed Belt at (${secondTile.tileX}, ${secondTile.tileY}).`);
    await expect(status).not.toHaveText(blockedPlacementMessage);

    const emptyTile = await findPlaceableBeltTile(page, [
      { x: firstTile.tileX, y: firstTile.tileY },
      { x: secondTile.tileX, y: secondTile.tileY },
    ]);
    await clickTile(page, emptyTile.tileX, emptyTile.tileY, "right");
    const blockedRemovalMessage = `Nothing to remove at (${emptyTile.tileX}, ${emptyTile.tileY}).`;
    await expect(status).toHaveText(blockedRemovalMessage);

    await clickTile(page, secondTile.tileX, secondTile.tileY, "right");
    await waitForEntityCount(page, baseEntityCount + 1);
    await expect(status).toHaveText(`Removed entity at (${secondTile.tileX}, ${secondTile.tileY}).`);
    await expect(status).not.toHaveText(blockedRemovalMessage);
  });
});
