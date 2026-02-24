import { expect, test, type Page } from "@playwright/test";

type EntityKind = "Miner" | "Belt" | "Splitter" | "Inserter" | "Furnace" | "Chest" | "Assembler" | "SolarPanel";
type TileCandidate = {
  found: boolean;
  tileX: number;
  tileY: number;
  reason: string;
};

const PALETTE = ["Miner", "Belt", "Splitter", "Inserter", "Furnace", "Chest", "Assembler", "SolarPanel"] as const;
type PlayerPosition = { x: number; y: number };
type AdjacentTileCandidate = PlayerPosition & { moveKey: "KeyW" | "KeyA" | "KeyS" | "KeyD" };
const WORLD_CANVAS_SELECTOR = '[data-testid="world-canvas"]';
const worldCanvas = (page: Page): ReturnType<Page["locator"]> => page.locator(WORLD_CANVAS_SELECTOR);

const waitForAppReady = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/");

  await expect(worldCanvas(page)).toBeVisible();
  for (const label of PALETTE) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }

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

const readPlayerPosition = async (page: Page): Promise<PlayerPosition> => {
  const position = await page.evaluate(() => {
    type RuntimeSimulation = {
      getPlacementSnapshot?: () => { player?: unknown };
      player?: unknown;
    };

    const sim = (window as { __SIM__?: unknown }).__SIM__;
    if (!sim || typeof sim !== "object") {
      return null;
    }

    const runtime = sim as RuntimeSimulation;
    const snapshot = typeof runtime.getPlacementSnapshot === "function" ? runtime.getPlacementSnapshot() : null;
    const player = snapshot?.player;
    if (
      player &&
      typeof player === "object" &&
      "x" in player &&
      "y" in player &&
      typeof (player as { x?: unknown }).x === "number" &&
      typeof (player as { y?: unknown }).y === "number"
    ) {
      return {
        x: (player as { x: number }).x,
        y: (player as { y: number }).y,
      };
    }

    return null;
  });

  if (!position) {
    throw new Error("Unable to read player position from simulation");
  }

  return position;
};

const readPlayerInventory = async (
  page: Page,
): Promise<{ ore: number; plate: number; gear: number; coal: number; wood: number; used: number; capacity: number }> => {
  const inventory = await page.evaluate(() => {
    type RuntimeSimulation = {
      getPlacementSnapshot?: () => { inventory?: unknown };
      inventory?: unknown;
    };

    const sim = (window as { __SIM__?: unknown }).__SIM__;
    if (!sim || typeof sim !== "object") {
      return null;
    }

    const runtime = sim as RuntimeSimulation;
    const snapshot = typeof runtime.getPlacementSnapshot === "function" ? runtime.getPlacementSnapshot() : null;
    const rawInventory = snapshot?.inventory ?? (runtime as unknown as { inventory?: unknown }).inventory;
    if (!rawInventory || typeof rawInventory !== "object") {
      return null;
    }

    const ore = typeof (rawInventory as { ore?: unknown }).ore === "number" ? Math.floor((rawInventory as { ore: number }).ore) : 0;
    const plate =
      typeof (rawInventory as { plate?: unknown }).plate === "number" ? Math.floor((rawInventory as { plate: number }).plate) : 0;
    const gear = typeof (rawInventory as { gear?: unknown }).gear === "number" ? Math.floor((rawInventory as { gear: number }).gear) : 0;
    const coal = typeof (rawInventory as { coal?: unknown }).coal === "number" ? Math.floor((rawInventory as { coal: number }).coal) : 0;
    const wood = typeof (rawInventory as { wood?: unknown }).wood === "number" ? Math.floor((rawInventory as { wood: number }).wood) : 0;
    const used = Math.floor(
      typeof (rawInventory as { used?: unknown }).used === "number" ? (rawInventory as { used: number }).used : ore + plate + gear + coal + wood,
    );
    const capacity =
      typeof (rawInventory as { capacity?: unknown }).capacity === "number"
        ? Math.floor((rawInventory as { capacity: number }).capacity)
        : 24;

    return { ore, plate, gear, coal, wood, used, capacity };
  });

  if (inventory === null) {
    throw new Error("Unable to read player inventory from simulation");
  }

  return inventory;
};

const findAdjacentPlaceableTile = async (
  page: Page,
  player: PlayerPosition,
  kind: EntityKind,
  rotation: 0 | 1 | 2 | 3,
  excludedTiles: PlayerPosition[] = [],
): Promise<AdjacentTileCandidate> => {
  const candidate = await page.evaluate(
    ({ player, kind, rotation, excludedTiles }) => {
      type PlacementSimulation = {
        width?: unknown;
        height?: unknown;
        canPlace?: (entityKind: EntityKind, tile: { x: number; y: number }, rotation: number) => boolean;
      };

      const sim = (window as { __SIM__?: unknown }).__SIM__;
      if (!sim || typeof sim !== "object") {
        return null;
      }

      const runtime = sim as PlacementSimulation;
      if (typeof runtime.canPlace !== "function") {
        return null;
      }

      const width =
        typeof runtime.width === "number" && Number.isInteger(runtime.width) && runtime.width > 0 ? runtime.width : 60;
      const height =
        typeof runtime.height === "number" && Number.isInteger(runtime.height) && runtime.height > 0 ? runtime.height : 40;

      const candidates: Array<{ x: number; y: number; moveKey: "KeyW" | "KeyA" | "KeyS" | "KeyD" }> = [
        { x: player.x - 1, y: player.y, moveKey: "KeyA" },
        { x: player.x + 1, y: player.y, moveKey: "KeyD" },
        { x: player.x, y: player.y - 1, moveKey: "KeyW" },
        { x: player.x, y: player.y + 1, moveKey: "KeyS" },
      ];

      const isExcluded = (x: number, y: number): boolean =>
        excludedTiles.some((excluded) => excluded.x === x && excluded.y === y);

      for (const candidate of candidates) {
        if (
          candidate.x < 0 ||
          candidate.y < 0 ||
          candidate.x >= width ||
          candidate.y >= height ||
          isExcluded(candidate.x, candidate.y)
        ) {
          continue;
        }

        if (runtime.canPlace(kind, { x: candidate.x, y: candidate.y }, rotation)) {
          return {
            found: true,
            tileX: candidate.x,
            tileY: candidate.y,
            moveKey: candidate.moveKey,
            reason: "",
          };
        }
      }

      return {
        found: false,
        tileX: 0,
        tileY: 0,
        moveKey: "KeyW",
        reason: "No adjacent placeable tile found",
      };
    },
    { player, kind, rotation, excludedTiles },
  );

  if (!candidate || candidate.found !== true) {
    throw new Error(`No adjacent ${kind} placeable tile from player position ${candidate?.reason ?? ""}`.trim());
  }

  return { x: candidate.tileX, y: candidate.tileY, moveKey: candidate.moveKey };
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

const findTreeTile = async (page: Page): Promise<{ tileX: number; tileY: number }> => {
  const tile = await page.evaluate(() => {
    type RuntimeMap = {
      isTree?: (x: number, y: number) => boolean;
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
    if (!map || typeof map.isTree !== "function") {
      return null;
    }

    const width =
      typeof runtime.width === "number" && Number.isInteger(runtime.width) && runtime.width > 0 ? runtime.width : 60;
    const height =
      typeof runtime.height === "number" && Number.isInteger(runtime.height) && runtime.height > 0 ? runtime.height : 40;

    for (let tileY = 0; tileY < height; tileY += 1) {
      for (let tileX = 0; tileX < width; tileX += 1) {
        if (map.isTree(tileX, tileY)) {
          return { tileX, tileY };
        }
      }
    }

    return null;
  });

  if (!tile) {
    throw new Error("Unable to find a tree resource tile");
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
      const canvas = document.querySelector('[data-testid="world-canvas"]');
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

      const canvas = document.querySelector('[data-testid="world-canvas"]');
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
  const canvas = worldCanvas(page);
  const point = await tileToCanvasPoint(page, tileX, tileY);
  await canvas.click({ position: point, button });
};

const movePlayerToTile = async (
  page: Page,
  targetX: number,
  targetY: number,
): Promise<{ x: number; y: number }> => {
  const result = await page.evaluate(
    ({ targetX, targetY }) => {
      type Direction = "N" | "E" | "S" | "W";
      type RuntimeSimulation = {
        width?: unknown;
        height?: unknown;
        movePlayer?: (direction: Direction) => { ok?: boolean };
        getPlayerSnapshot?: () => { x?: unknown; y?: unknown };
        player?: { x?: unknown; y?: unknown };
      };

      const sim = (window as { __SIM__?: unknown }).__SIM__;
      if (!sim || typeof sim !== "object") {
        return { ok: false, reason: "simulation unavailable", x: 0, y: 0 };
      }

      const runtime = sim as RuntimeSimulation;
      const movePlayer = runtime.movePlayer;
      if (typeof movePlayer !== "function") {
        return { ok: false, reason: "movement unavailable", x: 0, y: 0 };
      }

      const snapshot = typeof runtime.getPlayerSnapshot === "function" ? runtime.getPlayerSnapshot() : runtime.player;
      if (!snapshot || typeof snapshot !== "object") {
        return { ok: false, reason: "player unavailable", x: 0, y: 0 };
      }

      let x = typeof snapshot.x === "number" && Number.isInteger(snapshot.x) ? snapshot.x : 0;
      let y = typeof snapshot.y === "number" && Number.isInteger(snapshot.y) ? snapshot.y : 0;

      const moveOne = (direction: Direction): boolean => {
        const outcome = movePlayer(direction);
        if (!outcome || outcome.ok !== true) {
          return false;
        }

        const nextSnapshot = typeof runtime.getPlayerSnapshot === "function" ? runtime.getPlayerSnapshot() : runtime.player;
        if (!nextSnapshot || typeof nextSnapshot !== "object") {
          return false;
        }

        if (typeof nextSnapshot.x === "number" && Number.isInteger(nextSnapshot.x)) {
          x = nextSnapshot.x;
        }
        if (typeof nextSnapshot.y === "number" && Number.isInteger(nextSnapshot.y)) {
          y = nextSnapshot.y;
        }
        return true;
      };

      let loops = 0;
      const maxLoops = 10_000;
      while (x < targetX) {
        if (++loops > maxLoops) {
          return { ok: false, reason: "movement timeout", x, y };
        }
        if (!moveOne("E")) {
          return { ok: false, reason: "movement blocked east", x, y };
        }
      }

      while (x > targetX) {
        if (++loops > maxLoops) {
          return { ok: false, reason: "movement timeout", x, y };
        }
        if (!moveOne("W")) {
          return { ok: false, reason: "movement blocked west", x, y };
        }
      }

      while (y < targetY) {
        if (++loops > maxLoops) {
          return { ok: false, reason: "movement timeout", x, y };
        }
        if (!moveOne("S")) {
          return { ok: false, reason: "movement blocked south", x, y };
        }
      }

      while (y > targetY) {
        if (++loops > maxLoops) {
          return { ok: false, reason: "movement timeout", x, y };
        }
        if (!moveOne("N")) {
          return { ok: false, reason: "movement blocked north", x, y };
        }
      }

      return { ok: x === targetX && y === targetY, x, y, reason: "movement complete" };
    },
    { targetX, targetY },
  );

  if (!result.ok) {
    throw new Error(`Unable to move player: ${String(result.reason)} at (${result.x}, ${result.y})`);
  }

  return { x: result.x, y: result.y };
};

const findAdjacentTileToResource = async (
  page: Page,
  target: { tileX: number; tileY: number },
): Promise<{ tileX: number; tileY: number }> => {
  const tile = await page.evaluate(
    ({ targetX, targetY }) => {
      type RuntimeSimulation = {
        width?: unknown;
        height?: unknown;
      };

      const sim = (window as { __SIM__?: unknown }).__SIM__;
      if (!sim || typeof sim !== "object") {
        return null;
      }

      const runtime = sim as RuntimeSimulation;
      const width =
        typeof runtime.width === "number" && Number.isInteger(runtime.width) && runtime.width > 0 ? runtime.width : 60;
      const height =
        typeof runtime.height === "number" && Number.isInteger(runtime.height) && runtime.height > 0 ? runtime.height : 40;

      const candidates = [
        { tileX: targetX - 1, tileY: targetY },
        { tileX: targetX + 1, tileY: targetY },
        { tileX: targetX, tileY: targetY - 1 },
        { tileX: targetX, tileY: targetY + 1 },
      ];

      for (const candidate of candidates) {
        if (candidate.tileX < 0 || candidate.tileY < 0 || candidate.tileX >= width || candidate.tileY >= height) {
          continue;
        }
        return candidate;
      }

      return null;
    },
    { targetX: target.tileX, targetY: target.tileY },
  );

  if (tile === null) {
    throw new Error("No adjacent tile found for tree resource");
  }

  return tile;
};

test.describe("placement feedback e2e", () => {
  test("honors compact control contract for selection, rotation, resource removal, and pause toggle", async ({ page }) => {
    await waitForAppReady(page);

    const hudTool = page.getByTestId("hud-tool-value");
    const hudRotation = page.getByTestId("hud-rotation-value");
    const hudPause = page.getByTestId("hud-pause-value");
    const status = page.getByRole("status");

    for (let index = 0; index < PALETTE.length; index += 1) {
      const expected = PALETTE[index];
      const expectedDigit = `Digit${index + 1}`;
      await page.keyboard.press(expectedDigit);
      await expect(hudTool).toHaveAttribute("data-value", expected);
    }

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
    const pausedCountOne = await readEntityCount(page);
    await page.waitForTimeout(140);
    const pausedTickTwo = await readTickCount(page);
    const pausedCountTwo = await readEntityCount(page);
    expect(pausedTickTwo).toBe(pausedTickOne);
    expect(pausedCountTwo).toBe(pausedCountOne);
    expect(pausedTickOne).toBeGreaterThanOrEqual(beforePauseTick);
    expect(await hudTool.getAttribute("data-value")).toBe(beforePauseTool);
    expect(await hudRotation.getAttribute("data-value")).toBe(beforePauseRotation);
    await waitForEntityCount(page, startEntityCount + 1);

    await page.keyboard.press("Space");
    await expect(hudPause).toHaveAttribute("data-value", "running");
    const resumedTickStart = await readTickCount(page);
    expect(resumedTickStart).toBeGreaterThanOrEqual(pausedTickTwo);
    expect(resumedTickStart - pausedTickTwo).toBeLessThanOrEqual(1);
    await expect.poll(async () => readTickCount(page)).toBeGreaterThan(pausedTickTwo);
    await waitForEntityCount(page, startEntityCount + 1);
  });

  test("adds wood to inventory when mining an adjacent tree resource", async ({ page }) => {
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const beforeInventory = await readPlayerInventory(page);
    const treeTile = await findTreeTile(page);
    const adjacentTile = await findAdjacentTileToResource(page, treeTile);
    await movePlayerToTile(page, adjacentTile.tileX, adjacentTile.tileY);
    await page.keyboard.press("Escape");

    await clickTile(page, treeTile.tileX, treeTile.tileY, "left");
    await expect(status).toContainText(`Mined wood at (${treeTile.tileX}, ${treeTile.tileY}).`);

    const afterInventory = await readPlayerInventory(page);
    expect(afterInventory.wood).toBe(beforeInventory.wood + 1);
  });

  test("preserves wood inventory across runtime save/load", async ({ page }) => {
    await waitForAppReady(page);

    const treeTile = await findTreeTile(page);
    const adjacentTile = await findAdjacentTileToResource(page, treeTile);
    await movePlayerToTile(page, adjacentTile.tileX, adjacentTile.tileY);
    await page.keyboard.press("Escape");

    await clickTile(page, treeTile.tileX, treeTile.tileY, "left");
    const minedInventory = await readPlayerInventory(page);
    expect(minedInventory.wood).toBeGreaterThan(0);

    const savedState = await page.evaluate(() => {
      const runtime = (window as { __SIM__?: unknown }).__SIM__;
      if (!runtime || typeof runtime !== "object" || typeof (runtime as { saveState?: () => unknown }).saveState !== "function") {
        return null;
      }
      return (runtime as { saveState: () => unknown }).saveState();
    });

    if (savedState === null || typeof savedState !== "object") {
      throw new Error("Unable to capture runtime snapshot for wood persistence test");
    }

    await page.evaluate((state) => {
      const runtime = (window as { __SIM__?: unknown }).__SIM__;
      if (!runtime || typeof runtime !== "object" || typeof (runtime as { loadState?: (state: unknown) => void }).loadState !== "function") {
        return;
      }
      (runtime as { loadState: (state: unknown) => void }).loadState(state);
    }, savedState);

    const restoredInventory = await readPlayerInventory(page);
    expect(restoredInventory.wood).toBe(minedInventory.wood);
  });

  test("supports undo/redo history for placement and removal actions", async ({ page }) => {
    await waitForAppReady(page);

    const undo = page.getByTestId("control-undo");
    const redo = page.getByTestId("control-redo");
    const canvas = worldCanvas(page);
    const startEntityCount = await readEntityCount(page);

    await page.keyboard.press("Digit2");
    const beltTile = await findPlaceableBeltTile(page);
    const tilePoint = await tileToCanvasPoint(page, beltTile.tileX, beltTile.tileY);

    await canvas.click({ position: tilePoint });
    await waitForEntityCount(page, startEntityCount + 1);
    await canvas.click({ position: tilePoint, button: "right" });
    await waitForEntityCount(page, startEntityCount);

    await undo.click();
    await waitForEntityCount(page, startEntityCount + 1);

    await undo.click();
    await waitForEntityCount(page, startEntityCount);
    await expect(undo).toBeDisabled();

    await redo.click();
    await waitForEntityCount(page, startEntityCount + 1);
    await expect(redo).toBeEnabled();

    await redo.click();
    await waitForEntityCount(page, startEntityCount);
    await expect(redo).toBeDisabled();
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

  test("interaction clicks and occupied movement destinations are blocked for the player", async ({ page }) => {
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const canvas = worldCanvas(page);
    const startEntityCount = await readEntityCount(page);
    const player = await readPlayerPosition(page);

    const blockingTile = await findAdjacentPlaceableTile(page, player, "Belt", 0);
    await page.keyboard.press("Digit2");
    const blockingPoint = await tileToCanvasPoint(page, blockingTile.x, blockingTile.y);
    await canvas.click({ position: blockingPoint });
    await waitForEntityCount(page, startEntityCount + 1);

    await page.keyboard.press(blockingTile.moveKey);
    await expect(status).toContainText("Movement blocked: tile occupied");
    const playerAfterBlockedMove = await readPlayerPosition(page);
    expect(playerAfterBlockedMove).toEqual(player);

    const interactiveTile = await findAdjacentPlaceableTile(
      page,
      playerAfterBlockedMove,
      "Chest",
      0,
      [blockingTile],
    );
    await page.keyboard.press("Digit6");
    const interactivePoint = await tileToCanvasPoint(page, interactiveTile.x, interactiveTile.y);
    await canvas.click({ position: interactivePoint });
    await waitForEntityCount(page, startEntityCount + 2);

    await canvas.click({ position: interactivePoint });
    await expect(status).toHaveText("Target has no ready items.");
  });

  test("tool cycling wraps through ordered slots with bracket keys and mouse wheel", async ({ page }) => {
    await waitForAppReady(page);

    const canvas = worldCanvas(page);
    const status = page.getByRole("status");
    const hudTool = page.getByTestId("hud-tool-value");
    const box = await canvas.boundingBox();
    if (box === null) {
      throw new Error("Canvas is not available for wheel interaction");
    }

    await page.keyboard.press("Digit1");
    expect(await hudTool.getAttribute("data-value")).toBe("Miner");

    for (let index = 1; index < PALETTE.length; index += 1) {
      await page.keyboard.press("BracketRight");
      expect(await hudTool.getAttribute("data-value")).toBe(PALETTE[index]);
    }

    await page.keyboard.press("BracketRight");
    expect(await hudTool.getAttribute("data-value")).toBe("Miner");

    await page.keyboard.press("BracketLeft");
    expect(await hudTool.getAttribute("data-value")).toBe("SolarPanel");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 100);
    await expect(status).toContainText("Selected SolarPanel (tool");
    expect(await hudTool.getAttribute("data-value")).toBe("Miner");

    await page.mouse.wheel(0, -100);
    await expect(status).toContainText("Selected SolarPanel (tool");
    expect(await hudTool.getAttribute("data-value")).toBe("SolarPanel");

    await page.mouse.wheel(0, 100);
    expect(await hudTool.getAttribute("data-value")).toBe("Miner");
  });

  test("shows adjacency feedback for non-adjacent clicks before placement/interaction", async ({ page }) => {
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const canvas = worldCanvas(page);

    const player = await readPlayerPosition(page);
    const worldWidth = 60;
    const worldHeight = 40;
    const candidateTiles = [
      { x: player.x + 2, y: player.y },
      { x: player.x - 2, y: player.y },
      { x: player.x, y: player.y + 2 },
      { x: player.x, y: player.y - 2 },
    ].filter((tile) => tile.x >= 0 && tile.y >= 0 && tile.x < worldWidth && tile.y < worldHeight);

    let distantPoint: { x: number; y: number; tileX: number; tileY: number } | null = null;
    for (const tile of candidateTiles) {
      try {
        const point = await tileToCanvasPoint(page, tile.x, tile.y);
        distantPoint = { tileX: tile.x, tileY: tile.y, ...point };
        break;
      } catch {
        continue;
      }
    }

    if (distantPoint === null) {
      throw new Error("No visible non-adjacent tile candidate found for interaction-range test");
    }

    await page.keyboard.press("Escape");
    await canvas.click({ position: distantPoint });
    await expect(status).toContainText("Target must be adjacent to the player to interact.");
  });

  test("uses world-edge feedback when movement is blocked by map boundary", async ({ page }) => {
    await waitForAppReady(page);

    const status = page.getByRole("status");

    const savedState = await page.evaluate(() => {
      const sim = (window as { __SIM__?: unknown }).__SIM__;
      if (!sim || typeof sim !== "object") {
        return null;
      }
      const runtime = sim as {
        saveState?: () => unknown;
        loadState?: (state: unknown) => unknown;
      };
      if (typeof runtime.saveState !== "function") {
        return null;
      }
      return runtime.saveState();
    });

    if (savedState === null || typeof savedState !== "object") {
      throw new Error("Unable to capture runtime snapshot for boundary movement test");
    }

    const mutatedState = {
      ...savedState,
      player: {
        ...(savedState as { player: Record<string, unknown> }).player,
        x: 59,
        y: Math.max(0, Math.floor((savedState as { player: { y: number } }).player.y)),
      },
    };

    await page.evaluate((nextState) => {
      const sim = (window as { __SIM__?: unknown }).__SIM__;
      if (!sim || typeof sim !== "object") {
        return;
      }
      const runtime = sim as { loadState?: (state: unknown) => unknown };
      if (typeof runtime.loadState === "function") {
        runtime.loadState(nextState);
      }
    }, mutatedState);

    const edgePosition = await readPlayerPosition(page);
    expect(edgePosition.x).toBe(59);

    await page.keyboard.press("ArrowRight");
    await expect(status).toContainText("Movement blocked: world edge.");
    const afterMove = await readPlayerPosition(page);
    expect(afterMove).toEqual(edgePosition);
  });

  test("disallows placing entities on the player tile", async ({ page }) => {
    await waitForAppReady(page);

    const canvas = worldCanvas(page);
    const status = page.getByRole("status");
    const startEntityCount = await readEntityCount(page);
    const player = await readPlayerPosition(page);

    const canPlaceOnPlayerTile = await page.evaluate(
      ({ x, y }) => {
        const sim = (window as { __SIM__?: unknown }).__SIM__;
        if (!sim || typeof sim !== "object" || typeof (sim as { canPlace?: unknown }).canPlace !== "function") {
          return false;
        }

        return (sim as { canPlace: (entityKind: EntityKind, tile: { x: number; y: number }, rotation: number) => boolean })
          .canPlace("Belt", { x, y }, 1);
      },
      { x: player.x, y: player.y },
    );
    expect(canPlaceOnPlayerTile).toBe(false);

    await page.keyboard.press("Digit2");
    const point = await tileToCanvasPoint(page, player.x, player.y);
    await canvas.click({ position: point, force: true });
    await expect(status).toContainText("Placement blocked for Belt");
    expect(await readEntityCount(page)).toBe(startEntityCount);
  });
});
