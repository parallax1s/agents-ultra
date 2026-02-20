import { expect, test, type Page } from "@playwright/test";

type EntityKind = "Belt" | "Furnace" | "Inserter" | "Miner";
type Rotation = "N" | "E" | "S" | "W";

type SimEntity = {
  id: string;
  kind: string;
  pos: {
    x: number;
    y: number;
  };
  rot: Rotation;
};

type SimSnapshot = {
  width: number;
  height: number;
  tileSize: number;
  tick: number;
  tickCount: number;
  elapsedMs: number;
  entityCount: number;
  entities: SimEntity[];
};

type CandidateTile = {
  found: boolean;
  tileX: number;
  tileY: number;
  x: number;
  y: number;
  reason: string;
};

const PALETTE = ["Miner", "Belt", "Inserter", "Furnace"] as const;

const waitForAppReady = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/");

  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByRole("button", { name: "Miner" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Belt" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Inserter" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Furnace" })).toBeVisible();
  await expect
    .poll(async () => {
      const width = await page.locator("canvas").evaluate((element) => element.width);
      return width;
    })
    .toBeGreaterThan(0);

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
          togglePause?: unknown;
          getPlacementSnapshot?: unknown;
          getAllEntities?: unknown;
          canPlace?: unknown;
        };

        return (
          typeof runtime.width === "number" &&
          typeof runtime.height === "number" &&
          typeof runtime.tileSize === "number" &&
          typeof runtime.togglePause === "function" &&
          typeof runtime.getPlacementSnapshot === "function" &&
          typeof runtime.getAllEntities === "function" &&
          typeof runtime.canPlace === "function"
        );
      }),
    )
    .toBe(true);
};

const readSimSnapshot = async (page: Page): Promise<SimSnapshot> => {
  const snapshot = await page.evaluate(() => {
    type RuntimeSimulation = {
      width?: unknown;
      height?: unknown;
      tileSize?: unknown;
      tick?: unknown;
      tickCount?: unknown;
      elapsedMs?: unknown;
      getPlacementSnapshot?: () => {
        tick?: number;
        tickCount?: number;
        elapsedMs?: number;
        entityCount?: number;
      };
      getAllEntities?: () => unknown;
    };

    const sim = (window as { __SIM__?: unknown }).__SIM__;
    if (!sim || typeof sim !== "object") {
      return null;
    }

    const runtime = sim as RuntimeSimulation;
    const runtimeSnapshot = typeof runtime.getPlacementSnapshot === "function" ? runtime.getPlacementSnapshot() : null;
    const rawEntities = typeof runtime.getAllEntities === "function" ? runtime.getAllEntities() : [];
    const normalizedEntities = Array.isArray(rawEntities)
      ? rawEntities
          .map((entity): SimEntity | null => {
            if (!entity || typeof entity !== "object") {
              return null;
            }

            const maybeEntity = entity as {
              id?: unknown;
              kind?: unknown;
              pos?: unknown;
              rot?: unknown;
            };
            if (!maybeEntity.pos || typeof maybeEntity.pos !== "object") {
              return null;
            }

            const maybePos = maybeEntity.pos as { x?: unknown; y?: unknown };
            if (typeof maybePos.x !== "number" || typeof maybePos.y !== "number") {
              return null;
            }

            const rawRotation = typeof maybeEntity.rot === "string" ? maybeEntity.rot : "N";
            const normalizedRot =
              rawRotation === "N" || rawRotation === "E" || rawRotation === "S" || rawRotation === "W" ? rawRotation : "N";

            return {
              id: typeof maybeEntity.id === "string" ? maybeEntity.id : "",
              kind: typeof maybeEntity.kind === "string" ? maybeEntity.kind : "",
              pos: { x: maybePos.x, y: maybePos.y },
              rot: normalizedRot,
            };
          })
          .filter((entity): entity is SimEntity => entity !== null)
      : [];

    return {
      width: typeof runtime.width === "number" ? runtime.width : 60,
      height: typeof runtime.height === "number" ? runtime.height : 40,
      tileSize: typeof runtime.tileSize === "number" ? runtime.tileSize : 32,
      tick: typeof runtimeSnapshot?.tick === "number" ? runtimeSnapshot.tick : typeof runtime.tick === "number" ? runtime.tick : 0,
      tickCount:
        typeof runtimeSnapshot?.tickCount === "number"
          ? runtimeSnapshot.tickCount
          : typeof runtime.tickCount === "number"
            ? runtime.tickCount
            : 0,
      elapsedMs:
        typeof runtimeSnapshot?.elapsedMs === "number"
          ? runtimeSnapshot.elapsedMs
          : typeof runtime.elapsedMs === "number"
          ? runtime.elapsedMs
          : 0,
      entityCount:
        typeof runtimeSnapshot?.entityCount === "number" ? runtimeSnapshot.entityCount : normalizedEntities.length,
      entities: normalizedEntities,
    };
  });

  if (!snapshot) {
    throw new Error("Simulation hook not ready");
  }

  return snapshot;
};

const findPlaceableTile = async (
  page: Page,
  kind: EntityKind,
  rotation: 0 | 1 | 2 | 3,
): Promise<CandidateTile> => {
  const candidate = await page.evaluate(
    ({ kind, rotation }) => {
      type PlacementSimulation = {
        width?: unknown;
        height?: unknown;
        tileSize?: unknown;
        canPlace?: (entityKind: EntityKind, tile: { x: number; y: number }, rotation: number) => boolean;
      };

      const sim = (window as { __SIM__?: unknown }).__SIM__;
      const canvas = document.querySelector("canvas");
      if (!sim || typeof sim !== "object" || typeof sim.canPlace !== "function" || !canvas) {
        return {
          found: false,
          tileX: 0,
          tileY: 0,
          x: 0,
          y: 0,
          reason: "simulation not ready",
        };
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
        for (let tileX = 0; tileX < width; tileX += 1) {
          if (!runtime.canPlace(kind, { x: tileX, y: tileY }, rotation)) {
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
            x: Math.round(cx),
            y: Math.round(cy),
            reason: "",
          };
        }
      }

      return {
        found: false,
        tileX: 0,
        tileY: 0,
        x: 0,
        y: 0,
        reason: "no valid placement tile found in viewport",
      };
    },
    { kind, rotation },
  );

  if (!candidate.found) {
    throw new Error(`Unable to find placeable tile: ${candidate.reason}`);
  }

  return candidate;
};

const waitForEntityCount = async (page: Page, count: number): Promise<void> => {
  await expect
    .poll(async () => {
      const snapshot = await readSimSnapshot(page);
      return snapshot.entityCount;
    })
    .toBe(count);
};

const expectTickCountToIncrease = async (page: Page, expected: number): Promise<void> => {
  await expect
    .poll(async () => {
      const snapshot = await readSimSnapshot(page);
      return snapshot.tickCount;
    })
    .toBeGreaterThan(expected);
};

test.describe("Agents Ultra app smoke", () => {
  test("renders canvas and palette buttons", async ({ page }) => {
    await waitForAppReady(page);

    for (const label of PALETTE) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
  });

  test("validates select/rotate/place/remove/pause/resume flow", async ({ page }) => {
    await waitForAppReady(page);

    const miner = page.getByRole("button", { name: "Miner" });
    const belt = page.getByRole("button", { name: "Belt" });

    await expect(miner).toHaveAttribute("data-active", "true");
    await page.keyboard.press("Digit2");
    await expect(belt).toHaveAttribute("data-active", "true");
    await page.keyboard.press("KeyR");
    await page.waitForFunction(() => {
      const sim = (window as { __SIM__?: { tick?: number } }).__SIM__;
      return sim && typeof sim.tick === "number" && sim.tick > 0;
    });

    const canvas = page.locator("canvas");
    const baseline = await readSimSnapshot(page);
    await waitForEntityCount(page, baseline.entityCount);

    const tile = await findPlaceableTile(page, "Belt", 1);
    await canvas.click({ position: { x: tile.x, y: tile.y } });
    await waitForEntityCount(page, baseline.entityCount + 1);

    const afterPlace = await readSimSnapshot(page);
    const placed = afterPlace.entities.find((entity) => {
      return entity.pos.x === tile.tileX && entity.pos.y === tile.tileY;
    });

    expect(placed).toBeTruthy();
    expect(placed?.rot).toBe("E");

    await canvas.click({ position: { x: tile.x, y: tile.y }, button: "right" });
    await waitForEntityCount(page, baseline.entityCount);
    const afterRemove = await readSimSnapshot(page);
    expect(
      afterRemove.entities.some((entity) => {
        return entity.pos.x === tile.tileX && entity.pos.y === tile.tileY;
      }),
    ).toBe(false);

    const runningTick = (await readSimSnapshot(page)).tickCount;
    await expectTickCountToIncrease(page, runningTick);
    const pausedTick = (await readSimSnapshot(page)).tickCount;
    await page.keyboard.press("Space");
    await expect
      .poll(async () => {
        const pausedState = await readSimSnapshot(page);
        return pausedState.tickCount;
      })
      .toBeLessThanOrEqual(pausedTick + 1);

    await page.keyboard.press("Space");
    await expectTickCountToIncrease(page, pausedTick);
  });
});
