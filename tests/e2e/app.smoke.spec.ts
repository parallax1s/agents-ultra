import { expect, test, type Page } from "@playwright/test";

type EntityKind = "Miner" | "Belt" | "Splitter" | "Inserter" | "Furnace" | "Chest" | "Assembler" | "SolarPanel";
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

type TickSample = {
  tick: number;
  tickCount: number;
  elapsedMs: number;
  signature: string;
  entityStates: ReadonlyArray<{
    id: string;
    kind: string;
    rot: Rotation;
    x: number;
    y: number;
  }>;
};

type CandidateTile = {
  found: boolean;
  tileX: number;
  tileY: number;
  x: number;
  y: number;
  reason: string;
};

type TransportLayout = {
  found: boolean;
  miner: {
    tileX: number;
    tileY: number;
  };
  beltOne: {
    tileX: number;
    tileY: number;
  };
  beltTwo: {
    tileX: number;
    tileY: number;
  };
  inserter: {
    tileX: number;
    tileY: number;
  };
  furnace: {
    tileX: number;
    tileY: number;
  };
  reason: string;
};

const PALETTE = ["Miner", "Belt", "Splitter", "Inserter", "Furnace", "Chest", "Assembler", "SolarPanel"] as const;
const MAX_TICK_DELTA_PER_SAMPLE = 12;
const CANDIDATE_TILE_PADDING = 4;
const TRANSPORT_SAMPLE_DELAY_MS = 70;
const TRANSPORT_SAMPLE_COUNT = 54;
const TRANSPORT_MIN_WINDOWS = 4;
const TRANSPORT_CADENCE_TICKS = 15;
const SAVE_STORAGE_KEY = "agents-ultra-save-v1";
const SAVE_SLOT_STORAGE_KEY_PREFIX = `${SAVE_STORAGE_KEY}-slot-`;
const RUNTIME_SAVE_SLOT_COUNT = 3;
const RUNTIME_AGENT_PLAN_STORAGE_KEY = "agents-ultra-agent-plan-v1";
const RUNTIME_CHECKPOINT_STORAGE_KEY = "agents-ultra-save-v1-checkpoints-v1";
const WORLD_CANVAS_SELECTOR = '[data-testid="world-canvas"]';

const worldCanvas = (page: Page): ReturnType<Page["locator"]> => page.locator(WORLD_CANVAS_SELECTOR);

const waitForAppReady = async (page: Page): Promise<void> => {
  await page.setViewportSize({ width: 960, height: 640 });
  await page.goto("/");

  const canvas = worldCanvas(page);
  await expect(canvas).toBeVisible();
  for (const label of PALETTE) {
    await expect(page.getByRole("button", { name: label })).toBeVisible();
  }
  await expect
    .poll(async () => {
      const width = await canvas.evaluate((element) => element.width);
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
          getTileScreenPoint?: unknown;
          getTileCanvasPoint?: unknown;
        };

        return (
          typeof runtime.width === "number" &&
          typeof runtime.height === "number" &&
          typeof runtime.tileSize === "number" &&
          typeof runtime.togglePause === "function" &&
          typeof runtime.getPlacementSnapshot === "function" &&
          typeof runtime.getAllEntities === "function" &&
          typeof runtime.canPlace === "function"
          && (typeof runtime.getTileScreenPoint === "function" || typeof runtime.getTileCanvasPoint === "function")
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

  const normalizeEntityKind = (kind: string): string => {
    const trimmed = kind.trim();
    if (trimmed.length === 0) {
      return "";
    }
    if (/^[a-z]/.test(trimmed)) {
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }
    return trimmed;
  };

  return {
    ...snapshot,
    entities: snapshot.entities.map((entity) => ({
      ...entity,
      kind: normalizeEntityKind(entity.kind),
    })),
  };
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
      const canvas = document.querySelector('[data-testid="world-canvas"]');
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

const readEntityCount = async (page: Page): Promise<number> => {
  const snapshot = await readSimSnapshot(page);
  return snapshot.entityCount;
};

const readPersistedSaveState = async (page: Page): Promise<Record<string, unknown> | null> => {
  const raw = await page.evaluate((storageKey: string) => {
    const payload = window.localStorage.getItem(storageKey);
    return payload === null ? null : payload;
  }, SAVE_STORAGE_KEY);

  if (raw === null) {
    return null;
  }

  return JSON.parse(raw) as Record<string, unknown>;
};

const readRawSavePayload = async (page: Page): Promise<string | null> => {
  return page.evaluate((storageKey: string) => {
    return window.localStorage.getItem(storageKey);
  }, SAVE_STORAGE_KEY);
};

const readRawCheckpointPayload = async (page: Page): Promise<string | null> => {
  if (!/^https?:/.test(page.url())) {
    await page.goto("/");
  }

  return page.evaluate((storageKey: string) => {
    return window.localStorage.getItem(storageKey);
  }, RUNTIME_CHECKPOINT_STORAGE_KEY);
};

const writeRawCheckpointPayload = async (page: Page, rawPayload: string): Promise<void> => {
  if (!/^https?:/.test(page.url())) {
    await page.goto("/");
  }

  await page.evaluate(
    ({ storageKey, rawPayload }) => {
      window.localStorage.setItem(storageKey, rawPayload);
    },
    { storageKey: RUNTIME_CHECKPOINT_STORAGE_KEY, rawPayload },
  );
};

const clearRuntimeCheckpointStorage = async (page: Page): Promise<void> => {
  if (!/^https?:/.test(page.url())) {
    await page.goto("/");
  }

  await page.evaluate((storageKey: string) => {
    window.localStorage.removeItem(storageKey);
  }, RUNTIME_CHECKPOINT_STORAGE_KEY);
};

const writeRawSavePayload = async (page: Page, rawPayload: string): Promise<void> => {
  await page.evaluate(
    ({ storageKey, rawPayload }) => {
      window.localStorage.setItem(storageKey, rawPayload);
    },
    { storageKey: SAVE_STORAGE_KEY, rawPayload },
  );
};

const readSaveSlotState = async (page: Page): Promise<ReadonlyArray<{ index: number; hasValue: boolean }>> => {
  const state = await page.evaluate(
    ({ prefix, count }) => {
      const next = [] as Array<{ index: number; hasValue: boolean }>;
      for (let index = 0; index < count; index += 1) {
        const raw = window.localStorage.getItem(`${prefix}${index}`);
        next.push({
          index,
          hasValue: raw !== null,
        });
      }

      return next;
    },
    { prefix: SAVE_SLOT_STORAGE_KEY_PREFIX, count: RUNTIME_SAVE_SLOT_COUNT },
  );

  return state;
};

const clearSaveSlots = async (page: Page): Promise<void> => {
  await page.evaluate(
    ({ prefix, count }) => {
      for (let index = 0; index < count; index += 1) {
        window.localStorage.removeItem(`${prefix}${index}`);
      }
    },
    { prefix: SAVE_SLOT_STORAGE_KEY_PREFIX, count: RUNTIME_SAVE_SLOT_COUNT },
  );
};

const writeRawSaveSlotPayload = async (page: Page, slot: number, rawPayload: string): Promise<void> => {
  await page.evaluate(
    ({ prefix, slot, rawPayload }) => {
      window.localStorage.setItem(`${prefix}${slot}`, rawPayload);
    },
    { prefix: SAVE_SLOT_STORAGE_KEY_PREFIX, slot, rawPayload },
  );
};

const readRawSaveSlotPayload = async (page: Page, slot: number): Promise<string | null> => {
  return page.evaluate(
    ({ prefix, slot }) => window.localStorage.getItem(`${prefix}${slot}`),
    { prefix: SAVE_SLOT_STORAGE_KEY_PREFIX, slot },
  );
};

const readRawPlanPayload = async (page: Page): Promise<string | null> => {
  return page.evaluate((storageKey: string) => {
    return window.localStorage.getItem(storageKey);
  }, RUNTIME_AGENT_PLAN_STORAGE_KEY);
};

const writeRawPlanPayload = async (page: Page, rawPayload: string): Promise<void> => {
  await page.evaluate(
    ({ storageKey, rawPayload }) => {
      window.localStorage.setItem(storageKey, rawPayload);
    },
    { storageKey: RUNTIME_AGENT_PLAN_STORAGE_KEY, rawPayload },
  );
};

const clearRuntimePlanStorage = async (page: Page): Promise<void> => {
  await page.evaluate((storageKey: string) => {
    window.localStorage.removeItem(storageKey);
  }, RUNTIME_AGENT_PLAN_STORAGE_KEY);
};

const writeSaveSlotPayload = async (page: Page, slot: number, payload: unknown): Promise<void> => {
  await writeRawSaveSlotPayload(page, slot, JSON.stringify(payload));
};

const VALID_SLOT_STATE = {
  version: 1,
  width: 60,
  height: 40,
  tick: 0,
  tickCount: 0,
  elapsedMs: 0,
  paused: false,
  player: {
    x: 0,
    y: 0,
    rot: "S",
    fuel: 100,
    maxFuel: 100,
  },
  inventory: {
    ore: 0,
    plate: 0,
    gear: 0,
    coal: 0,
    used: 0,
    capacity: 24,
  },
  entities: [],
} as const;

const readPlayerPosition = async (page: Page): Promise<{ x: number; y: number }> => {
  const position = await page.evaluate(() => {
    type RuntimeSimulation = {
      getPlayerSnapshot?: () => {
        x?: number;
        y?: number;
        rot?: string;
        fuel?: number;
        maxFuel?: number;
      };
      player?: {
        x?: number;
        y?: number;
      };
    };

    const sim = (window as { __SIM__?: unknown }).__SIM__;
    if (!sim || typeof sim !== "object") {
      return null;
    }

    const runtime = sim as RuntimeSimulation;
    const player = typeof runtime.getPlayerSnapshot === "function" ? runtime.getPlayerSnapshot() : runtime.player;
    if (!player || typeof player !== "object") {
      return null;
    }

    return {
      x: typeof player.x === "number" ? player.x : 0,
      y: typeof player.y === "number" ? player.y : 0,
    };
  });

  if (position === null) {
    throw new Error("Player position unavailable");
  }

  return position;
};

const readCameraState = async (page: Page): Promise<{ zoom: number; panX: number; panY: number }> => {
  const camera = await page.evaluate(() => {
    type RuntimeCamera = {
      zoom?: unknown;
      panX?: unknown;
      panY?: unknown;
    };

    const raw = (window as { __CAMERA__?: RuntimeCamera }).__CAMERA__;
    if (!raw || typeof raw !== "object") {
      return null;
    }

    return {
      zoom: typeof raw.zoom === "number" ? raw.zoom : null,
      panX: typeof raw.panX === "number" ? raw.panX : null,
      panY: typeof raw.panY === "number" ? raw.panY : null,
    };
  });

  if (camera === null || camera.zoom === null || camera.panX === null || camera.panY === null) {
    throw new Error("Camera state unavailable");
  }

  return camera;
};

const readTileCanvasPoint = async (page: Page, tile: { x: number; y: number }): Promise<{ x: number; y: number; canvasWidth: number; canvasHeight: number } | null> => {
  return page.evaluate((payload) => {
    const sim = (window as { __SIM__?: unknown }).__SIM__;
    const canvas = document.querySelector(WORLD_CANVAS_SELECTOR);
    if (!sim || typeof sim !== "object" || !(canvas instanceof HTMLCanvasElement)) {
      return null;
    }

    const runtime = sim as {
      getTileCanvasPoint?: (pointTile: { x: number; y: number }) => { x: number; y: number } | null;
    };

    if (typeof runtime.getTileCanvasPoint !== "function") {
      return null;
    }

    const point = runtime.getTileCanvasPoint(payload.tile);
    if (point === null || !point || typeof point.x !== "number" || typeof point.y !== "number") {
      return null;
    }

    return {
      x: Math.round(point.x),
      y: Math.round(point.y),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
    };
  }, { tile });
};

const expectActiveSelection = async (page: Page, expected: string): Promise<void> => {
  for (const label of PALETTE) {
    const button = page.getByRole("button", { name: label });
    await expect(button).toHaveAttribute("data-active", label === expected ? "true" : "false");
  }
};

const enableTutorialMode = async (page: Page): Promise<void> => {
  const tutorialToggle = page.getByRole("button", { name: /Tutorial Mode:/ });
  const label = await tutorialToggle.textContent();
  if (label?.includes("Off") === true) {
    await tutorialToggle.click();
    await expect(tutorialToggle).toContainText("Tutorial Mode: On");
  }
};

const expectNextTutorialMissionToContain = async (page: Page, expected: string): Promise<void> => {
  await expect(page.getByTestId("hud-tutorial-next-text")).toContainText(expected);
};

const movePlayerOneStep = async (page: Page): Promise<boolean> => {
  const start = await readPlayerPosition(page);
  const moveKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"];

  for (const key of moveKeys) {
    await page.keyboard.press(key);
    const next = await readPlayerPosition(page);
    if (next.x !== start.x || next.y !== start.y) {
      return true;
    }
  }

  return false;
};

const rotateToDirection = async (page: Page, expected: "N" | "E" | "S" | "W"): Promise<void> => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rotationValue = page.getByTestId("hud-rotation-value");
    const current = await rotationValue.getAttribute("data-value");
    if (current === expected) {
      return;
    }
    await page.keyboard.press("KeyR");
    await page.waitForTimeout(8);
  }

  throw new Error(`Unable to rotate selection to ${expected} after repeated key presses`);
};

const expectSteadyCadence = (
  samples: readonly TickSample[],
  cadenceTicks: number = TRANSPORT_CADENCE_TICKS,
  minWindows: number = TRANSPORT_MIN_WINDOWS,
): void => {
  expect(samples.length).toBeGreaterThan(1);
  expect(minWindows).toBeGreaterThan(0);

  const observedWindows = new Set<number>();
  let previousWindow = Math.floor(samples[0]?.tickCount ? samples[0].tickCount / cadenceTicks : 0);
  observedWindows.add(previousWindow);

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (previous === undefined || current === undefined) {
      continue;
    }

    expect(current.tickCount).toBeGreaterThanOrEqual(previous.tickCount);
    const delta = current.tickCount - previous.tickCount;
    expect(delta).toBeLessThanOrEqual(MAX_TICK_DELTA_PER_SAMPLE);
    const currentWindow = Math.floor(current.tickCount / cadenceTicks);
    observedWindows.add(currentWindow);
    expect(currentWindow).toBeGreaterThanOrEqual(previousWindow);
    expect(currentWindow - previousWindow).toBeLessThanOrEqual(1);
    previousWindow = currentWindow;
  }

  expect(observedWindows.size).toBeGreaterThanOrEqual(minWindows);
};

const expectTickCountToIncrease = async (page: Page, expected: number): Promise<void> => {
  await expect
    .poll(async () => {
      const snapshot = await readSimSnapshot(page);
      return snapshot.tickCount;
    })
    .toBeGreaterThan(expected);
};

const createEntitySignature = (snapshot: SimSnapshot): string => {
  return snapshot.entities
    .map((entity) => `${entity.id}:${entity.kind}:${entity.rot}:${entity.pos.x},${entity.pos.y}`)
    .sort()
    .join("|");
};

const readEntityStates = (snapshot: SimSnapshot): ReadonlyArray<{ id: string; kind: string; rot: Rotation; x: number; y: number }> => {
  return snapshot.entities
    .map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      rot: entity.rot,
      x: entity.pos.x,
      y: entity.pos.y,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
};

const expectEntityStep = (
  previous: ReadonlyArray<{ id: string; kind: string; rot: string; x: number; y: number }>,
  current: ReadonlyArray<{ id: string; kind: string; rot: string; x: number; y: number }>,
): void => {
  expect(current.length).toBe(previous.length);
  expect(current.map((entity) => entity.id)).toEqual(previous.map((entity) => entity.id));

  for (let index = 0; index < previous.length; index += 1) {
    const from = previous[index];
    const to = current[index];
    if (from === undefined || to === undefined) {
      throw new Error("Entity state snapshot missing expected entry");
    }

    const xDelta = Math.abs(from.x - to.x);
    const yDelta = Math.abs(from.y - to.y);
    const maxTileDelta = Math.max(xDelta, yDelta);
    expect(maxTileDelta).toBeLessThanOrEqual(1);
  }
};

const sampleTickSamples = async (page: Page, sampleCount: number, delayMs: number): Promise<TickSample[]> => {
  const samples: TickSample[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const snapshot = await readSimSnapshot(page);
    samples.push({
      tick: snapshot.tick,
      tickCount: snapshot.tickCount,
      elapsedMs: snapshot.elapsedMs,
      signature: createEntitySignature(snapshot),
      entityStates: readEntityStates(snapshot),
    });
    if (sample + 1 < sampleCount) {
      await page.waitForTimeout(delayMs);
    }
  }

  return samples;
};

const expectSamplesNoProgress = (samples: readonly TickSample[]): void => {
  expect(samples.length).toBeGreaterThan(1);
  const baseline = samples[0]?.signature;
  const baselineTick = samples[0]?.tickCount;
  for (const sample of samples) {
    expect(sample.tickCount).toBe(baselineTick);
    expect(sample.signature).toBe(baseline);
  }
};

const expectTickCadence = (samples: readonly TickSample[]): void => {
  expect(samples.length).toBeGreaterThan(1);

  let observedForwardMovement = false;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];

    expect(current.tickCount).toBeGreaterThanOrEqual(previous.tickCount);
    expect(current.tickCount - previous.tickCount).toBeLessThanOrEqual(6);

    if (current.tickCount > previous.tickCount) {
      observedForwardMovement = true;
    }

    expectEntityStep(previous.entityStates, current.entityStates);
  }

  expect(observedForwardMovement).toBeTruthy();
};

type RuntimeItemInventory = {
  ore: number;
  plate: number;
  gear: number;
  coal: number;
  wood: number;
  used: number;
  capacity: number;
};

const readRuntimeInventory = async (page: Page): Promise<RuntimeItemInventory> => {
  const snapshot = await page.evaluate(() => {
    const sim = (window as { __SIM__?: unknown }).__SIM__;
    if (!sim || typeof sim !== "object") {
      return null;
    }

    const inventory = typeof (sim as { getInventorySnapshot?: () => unknown }).getInventorySnapshot === "function"
      ? (sim as { getInventorySnapshot: () => unknown }).getInventorySnapshot()
      : null;
    if (!inventory || typeof inventory !== "object") {
      return null;
    }

    const normalize = (value: unknown): number => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return 0;
      }
      return Math.max(0, Math.floor(value));
    };

    return {
      ore: normalize((inventory as { ore?: unknown }).ore),
      plate: normalize((inventory as { plate?: unknown }).plate),
      gear: normalize((inventory as { gear?: unknown }).gear),
      coal: normalize((inventory as { coal?: unknown }).coal),
      wood: normalize((inventory as { wood?: unknown }).wood),
      used: normalize((inventory as { used?: unknown }).used),
      capacity: normalize((inventory as { capacity?: unknown }).capacity),
    };
  });

  if (snapshot === null) {
    throw new Error("Runtime inventory snapshot unavailable");
  }

  return snapshot;
};

const movePlayerToAdjacentMineableTile = async (page: Page): Promise<{
  mineableTileX: number;
  mineableTileY: number;
  resourceType: "ore" | "coal" | "wood";
  beforeRemaining: number;
}> => {
  const payload = await page.evaluate(() => {
    type Direction = "N" | "E" | "S" | "W";
    const deltas: ReadonlyArray<{ dx: number; dy: number; dir: Direction }> = [
      { dx: 0, dy: -1, dir: "N" },
      { dx: 1, dy: 0, dir: "E" },
      { dx: 0, dy: 1, dir: "S" },
      { dx: -1, dy: 0, dir: "W" },
    ];

    const sim = (window as { __SIM__?: unknown }).__SIM__;
    if (!sim || typeof sim !== "object") {
      return {
        found: false,
        mineableTileX: 0,
        mineableTileY: 0,
        resourceType: "ore",
        beforeRemaining: 0,
        reason: "simulation not ready",
      };
    }

    const runtime = sim as {
      getPlayerSnapshot?: () => unknown;
      getMap?: () => unknown;
      hasEntityAt?: (tile: { x: number; y: number }) => boolean;
      movePlayer?: (direction: Direction) => unknown;
      width?: unknown;
      height?: unknown;
    };

    if (typeof runtime.getPlayerSnapshot !== "function") {
      return {
        found: false,
        mineableTileX: 0,
        mineableTileY: 0,
        resourceType: "ore",
        beforeRemaining: 0,
        reason: "runtime player snapshot missing",
      };
    }

    if (typeof runtime.getMap !== "function") {
      return {
        found: false,
        mineableTileX: 0,
        mineableTileY: 0,
        resourceType: "ore",
        beforeRemaining: 0,
        reason: "runtime map helper missing",
      };
    }

    const map = runtime.getMap() as {
      isOre?: (x: number, y: number) => boolean;
      isTree?: (x: number, y: number) => boolean;
      isCoal?: (x: number, y: number) => boolean;
      getResourceAmountAt?: (x: number, y: number) => number;
      isWithinBounds?: (x: number, y: number) => boolean;
    };
    const width = typeof runtime.width === "number" && runtime.width > 0 ? runtime.width : 60;
    const height = typeof runtime.height === "number" && runtime.height > 0 ? runtime.height : 40;
    const isResource = (x: number, y: number): boolean => {
      if (typeof map.isWithinBounds === "function" && !map.isWithinBounds(x, y)) {
        return false;
      }
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return false;
      }
      const oreCheck = typeof map.isOre === "function" ? map.isOre(x, y) : false;
      const treeCheck = typeof map.isTree === "function" ? map.isTree(x, y) : false;
      return oreCheck || treeCheck;
    };
    const readRemaining = (x: number, y: number): number => {
      const amount = typeof map.getResourceAmountAt === "function" ? map.getResourceAmountAt(x, y) : 0;
      return Number.isFinite(amount) && amount > 0 ? amount : 0;
    };
    const canStand = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= width || y >= height) {
        return false;
      }
      return typeof runtime.hasEntityAt === "function" ? runtime.hasEntityAt({ x, y }) !== true : true;
    };

    const player = runtime.getPlayerSnapshot();
    if (!player || typeof player !== "object") {
      return {
        found: false,
        mineableTileX: 0,
        mineableTileY: 0,
        resourceType: "ore",
        beforeRemaining: 0,
        reason: "player snapshot missing",
      };
    }

    const startX = typeof (player as { x?: unknown }).x === "number" ? (player as { x: number }).x : 0;
    const startY = typeof (player as { y?: unknown }).y === "number" ? (player as { y: number }).y : 0;
    const movePlayer = runtime.movePlayer;
    if (typeof movePlayer !== "function") {
      return {
        found: false,
        mineableTileX: 0,
        mineableTileY: 0,
        resourceType: "ore",
        beforeRemaining: 0,
        reason: "move helper missing",
      };
    }

    if (startX < 0 || startY < 0 || startX >= width || startY >= height) {
      return {
        found: false,
        mineableTileX: 0,
        mineableTileY: 0,
        resourceType: "ore",
        beforeRemaining: 0,
        reason: "player out of bounds",
      };
    }

    for (const direction of deltas) {
      const mineX = startX + direction.dx;
      const mineY = startY + direction.dy;
      if (isResource(mineX, mineY)) {
        const kind =
          typeof map.isTree === "function" && map.isTree(mineX, mineY)
            ? "wood"
            : typeof map.isCoal === "function" && map.isCoal(mineX, mineY)
              ? "coal"
              : "ore";
        return {
          found: true,
          mineableTileX: mineX,
          mineableTileY: mineY,
          resourceType: kind,
          beforeRemaining: readRemaining(mineX, mineY),
          reason: "adjacent",
        };
      }
    }

    const startKey = `${startX},${startY}`;
    const queue: Array<{ x: number; y: number }> = [{ x: startX, y: startY }];
    const visited = new Set<string>([startKey]);
    const parent = new Map<
      string,
      {
        fromX: number;
        fromY: number;
        dir: Direction;
      }
    >();

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      if (current === undefined) {
        continue;
      }

      for (const direction of deltas) {
        const candidateX = current.x + direction.dx;
        const candidateY = current.y + direction.dy;
        if (isResource(candidateX, candidateY)) {
          const mineKey = `${candidateX},${candidateY}`;
          const kind =
            typeof map.isTree === "function" && map.isTree(candidateX, candidateY)
              ? "wood"
              : typeof map.isCoal === "function" && map.isCoal(candidateX, candidateY)
                ? "coal"
                : "ore";
          const path: Direction[] = [];
          const target = current;
          let cursor = `${target.x},${target.y}`;
          while (cursor !== startKey) {
            const step = parent.get(cursor);
            if (step === undefined) {
              return {
                found: false,
                mineableTileX: 0,
                mineableTileY: 0,
                resourceType: "ore",
                beforeRemaining: 0,
                reason: `path missing parent for ${cursor}`,
              };
            }
            path.unshift(step.dir);
            cursor = `${step.fromX},${step.fromY}`;
          }

          for (const dir of path) {
            const outcome = movePlayer(dir) as { ok?: boolean } | undefined;
            if (outcome?.ok !== true) {
              return {
                found: false,
                mineableTileX: 0,
                mineableTileY: 0,
                resourceType: "ore",
                beforeRemaining: 0,
                reason: "path blocked while moving",
              };
            }
          }

          return {
            found: true,
            mineableTileX: candidateX,
            mineableTileY: candidateY,
            resourceType: kind,
            beforeRemaining: readRemaining(candidateX, candidateY),
            reason: mineKey,
          };
        }

        const nextKey = `${candidateX},${candidateY}`;
        if (visited.has(nextKey) || !canStand(candidateX, candidateY)) {
          continue;
        }
        visited.add(nextKey);
        parent.set(nextKey, { fromX: current.x, fromY: current.y, dir: direction.dir });
        queue.push({ x: candidateX, y: candidateY });
      }
    }

    return {
      found: false,
      mineableTileX: 0,
      mineableTileY: 0,
      resourceType: "ore",
      beforeRemaining: 0,
      reason: "no mineable tile reachable",
    };
  });

  if (payload.found !== true) {
    throw new Error(payload.reason ?? "No mineable tile found in range");
  }

  return {
    mineableTileX: payload.mineableTileX,
    mineableTileY: payload.mineableTileY,
    resourceType: payload.resourceType,
    beforeRemaining: payload.beforeRemaining,
  };
};

const readRuntimeResourceRemaining = async (page: Page, tile: { x: number; y: number }): Promise<number> => {
  const remaining = await page.evaluate((payload) => {
    const sim = (window as { __SIM__?: unknown }).__SIM__;
    if (!sim || typeof sim !== "object") {
      return null;
    }

    const runtime = sim as { getMap?: () => unknown };
    if (typeof runtime.getMap !== "function") {
      return null;
    }

    const map = runtime.getMap() as { getResourceAmountAt?: (x: number, y: number) => number };
    if (typeof map.getResourceAmountAt !== "function") {
      return null;
    }

    const remaining = map.getResourceAmountAt(payload.x, payload.y);
    return Number.isFinite(remaining) ? remaining : null;
  }, tile);

  if (remaining === null) {
    throw new Error(`Unable to read resource remaining at ${tile.x},${tile.y}`);
  }

  return remaining;
};

const findTransportLayout = async (page: Page): Promise<TransportLayout> => {
  const layout = await page.evaluate(
    ({ candidateTilePadding }) => {
      type TransportSimulation = {
        width?: unknown;
        height?: unknown;
        canPlace?: (entityKind: EntityKind, tile: { x: number; y: number }, rotation: number) => boolean;
      };

      const sim = (window as { __SIM__?: unknown }).__SIM__;
      if (!sim || typeof sim !== "object") {
        return {
          found: false,
          miner: { tileX: 0, tileY: 0 },
          beltOne: { tileX: 0, tileY: 0 },
          beltTwo: { tileX: 0, tileY: 0 },
          inserter: { tileX: 0, tileY: 0 },
          furnace: { tileX: 0, tileY: 0 },
          reason: "simulation not ready",
        };
      }

      const runtime = sim as TransportSimulation;
      const width =
        typeof runtime.width === "number" && Number.isInteger(runtime.width) && runtime.width > candidateTilePadding
          ? runtime.width
          : 60;
      const height =
        typeof runtime.height === "number" && Number.isInteger(runtime.height) && runtime.height > 0
          ? runtime.height
          : 40;
      if (typeof runtime.canPlace !== "function") {
        return {
          found: false,
          miner: { tileX: 0, tileY: 0 },
          beltOne: { tileX: 0, tileY: 0 },
          beltTwo: { tileX: 0, tileY: 0 },
          inserter: { tileX: 0, tileY: 0 },
          furnace: { tileX: 0, tileY: 0 },
          reason: "canPlace helper unavailable",
        };
      }

      for (let tileY = 0; tileY < height; tileY += 1) {
        for (let tileX = 0; tileX + candidateTilePadding < width; tileX += 1) {
          const miner = { x: tileX, y: tileY };
          const beltOne = { x: tileX + 1, y: tileY };
          const beltTwo = { x: tileX + 2, y: tileY };
          const inserter = { x: tileX + 3, y: tileY };
          const furnace = { x: tileX + 4, y: tileY };

          if (
            !runtime.canPlace("Miner", miner, 1) ||
            !runtime.canPlace("Belt", beltOne, 1) ||
            !runtime.canPlace("Belt", beltTwo, 1) ||
            !runtime.canPlace("Inserter", inserter, 1) ||
            !runtime.canPlace("Furnace", furnace, 1)
          ) {
            continue;
          }

          return {
            found: true,
            miner: { tileX: miner.x, tileY: miner.y },
            beltOne: { tileX: beltOne.x, tileY: beltOne.y },
            beltTwo: { tileX: beltTwo.x, tileY: beltTwo.y },
            inserter: { tileX: inserter.x, tileY: inserter.y },
            furnace: { tileX: furnace.x, tileY: furnace.y },
            reason: "",
          };
        }
      }

      return {
        found: false,
        miner: { tileX: 0, tileY: 0 },
        beltOne: { tileX: 0, tileY: 0 },
        beltTwo: { tileX: 0, tileY: 0 },
        inserter: { tileX: 0, tileY: 0 },
        furnace: { tileX: 0, tileY: 0 },
        reason: "no valid transport lane found",
      };
    },
    { candidateTilePadding: CANDIDATE_TILE_PADDING },
  );

  if (!layout.found) {
    throw new Error(`Unable to find transport lane: ${layout.reason}`);
  }

  return layout;
};

const tileToCanvasPoint = async (page: Page, tileX: number, tileY: number): Promise<{ x: number; y: number }> => {
  const point = await page.evaluate(
    ({ tileX, tileY }) => {
      type Point = { x: number; y: number };
      type PlacementSimulation = {
        width?: unknown;
        height?: unknown;
        tileSize?: unknown;
        getTileScreenPoint?: (tile: { x: number; y: number }) => Point | null;
        getTileCanvasPoint?: (tile: { x: number; y: number }) => Point | null;
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
      const getTileScreenPoint = runtime.getTileScreenPoint;
      if (typeof getTileScreenPoint === "function") {
        const runtimePoint = getTileScreenPoint({ x: tileX, y: tileY });
        if (
          runtimePoint !== null &&
          Number.isFinite(runtimePoint.x) &&
          Number.isFinite(runtimePoint.y) &&
          Number.isInteger(runtimePoint.x) &&
          Number.isInteger(runtimePoint.y)
        ) {
          return {
            found: true,
            x: runtimePoint.x,
            y: runtimePoint.y,
          };
        }
      }

      const getTileCanvasPoint = runtime.getTileCanvasPoint;
      if (typeof getTileCanvasPoint === "function") {
        const runtimePoint = getTileCanvasPoint({ x: tileX, y: tileY });
        if (
          runtimePoint !== null &&
          Number.isFinite(runtimePoint.x) &&
          Number.isFinite(runtimePoint.y) &&
          Number.isInteger(runtimePoint.x) &&
          Number.isInteger(runtimePoint.y)
        ) {
          return {
            found: true,
            x: runtimePoint.x,
            y: runtimePoint.y,
          };
        }
      }

      const width =
        typeof runtime.width === "number" && Number.isInteger(runtime.width) && runtime.width > 0 ? runtime.width : 60;
      const height =
        typeof runtime.height === "number" && Number.isInteger(runtime.height) && runtime.height > 0 ? runtime.height : 40;
      const tileSize =
        typeof runtime.tileSize === "number" && Number.isInteger(runtime.tileSize) && runtime.tileSize > 0
          ? runtime.tileSize
          : 32;
      if (!Number.isInteger(tileX) || tileX < 0 || tileX >= width || !Number.isInteger(tileY) || tileY < 0 || tileY >= height) {
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

      return { found: true, x: Math.round(cx), y: Math.round(cy) };
    },
    { tileX, tileY },
  );

  if (!point.found) {
    throw new Error(`Tile (${tileX}, ${tileY}) is not visible in canvas: ${point.reason}`);
  }

  return { x: point.x, y: point.y };
};

const placeEntityAt = async (page: Page, kind: EntityKind, tileX: number, tileY: number): Promise<void> => {
  const hotkeyByKind: Readonly<Record<EntityKind, string>> = {
    Miner: "Digit1",
    Belt: "Digit2",
    Splitter: "Digit3",
    Inserter: "Digit4",
    Furnace: "Digit5",
    Chest: "Digit6",
    Assembler: "Digit7",
    SolarPanel: "Digit8",
  };

  const canvas = worldCanvas(page);
  await page.keyboard.press(hotkeyByKind[kind]);
  await expectActiveSelection(page, kind);
  const point = await tileToCanvasPoint(page, tileX, tileY);
  await canvas.click({ position: point });
};

const expectNoResumeJump = (
  pausedSamples: readonly TickSample[],
  resumedSamples: readonly TickSample[],
  maxJump = MAX_TICK_DELTA_PER_SAMPLE,
): void => {
  const before = pausedSamples[pausedSamples.length - 1];
  const first = resumedSamples[0];
  if (before === undefined || first === undefined) {
    return;
  }

  let observedResumeDelta = 0;
  for (let index = 1; index < resumedSamples.length; index += 1) {
    const previous = resumedSamples[index - 1];
    const current = resumedSamples[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    observedResumeDelta = Math.max(observedResumeDelta, current.tickCount - previous.tickCount);
  }

  const allowedJump = Math.max(maxJump, observedResumeDelta);
  const jump = first.tickCount - before.tickCount;
  expect(jump).toBeGreaterThanOrEqual(0);
  expect(jump).toBeLessThanOrEqual(allowedJump);
};

const expectResumeFromPausedBoundary = (
  pausedSamples: readonly TickSample[],
  resumedSamples: readonly TickSample[],
  maxFirstStepJump = 1,
): void => {
  const pausedLast = pausedSamples[pausedSamples.length - 1];
  const resumedFirst = resumedSamples[0];
  if (pausedLast === undefined || resumedFirst === undefined) {
    throw new Error("Missing pause/resume samples for fixed-step boundary assertion");
  }

  expect(resumedFirst.signature).toBe(pausedLast.signature);
  expect(resumedFirst.tickCount).toBeGreaterThanOrEqual(pausedLast.tickCount);
  expect(resumedFirst.tickCount - pausedLast.tickCount).toBeLessThanOrEqual(maxFirstStepJump);

  const resumedLast = resumedSamples[resumedSamples.length - 1];
  if (resumedLast === undefined) {
    throw new Error("Missing resumed sample range for fixed-step boundary assertion");
  }

  expect(resumedLast.tickCount).toBeGreaterThan(pausedLast.tickCount);
};

const attachRuntimeErrorCollectors = (page: Page): { pageErrors: string[]; consoleErrors: string[] } => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });

  return { pageErrors, consoleErrors };
};

test.describe("Agents Ultra app smoke", () => {
  test("renders canvas and palette buttons", async ({ page }) => {
    await waitForAppReady(page);

    for (const label of PALETTE) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
  });

  test("exposes tile projection helper methods on runtime simulation", async ({ page }) => {
    await waitForAppReady(page);

    const projection = await page.evaluate(() => {
      const sim = (window as { __SIM__?: unknown }).__SIM__;
      if (!sim || typeof sim !== "object") {
        return null;
      }

      const runtime = sim as {
        getTileScreenPoint?: (tile: { x: number; y: number }) => { x: number; y: number } | null;
        getTileCanvasPoint?: (tile: { x: number; y: number }) => { x: number; y: number } | null;
      };
      const tile = { x: 4, y: 6 };

      return {
        hasScreenPoint: typeof runtime.getTileScreenPoint === "function",
        hasCanvasPoint: typeof runtime.getTileCanvasPoint === "function",
        screenPoint: runtime.getTileScreenPoint?.(tile),
        canvasPoint: runtime.getTileCanvasPoint?.(tile),
      };
    });

    expect(projection).not.toBeNull();
    if (projection === null) {
      return;
    }

    expect(projection.hasScreenPoint).toBe(true);
    expect(projection.hasCanvasPoint).toBe(true);
    expect(projection.screenPoint).toEqual(projection.canvasPoint);
  });

  test("maps palette clicks and numeric hotkeys to the same tool order", async ({ page }) => {
    await waitForAppReady(page);

    const hudTool = page.getByTestId("hud-tool-value");
    const expectedHotkeys = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8"];
    await page.keyboard.press("Digit0");
    await expect(hudTool).toHaveAttribute("data-value", "None");

    for (const [index, label] of PALETTE.entries()) {
      const clickTarget = page.getByTestId(`palette-tool-${label.toLowerCase()}`);
      await clickTarget.click();
      await expectActiveSelection(page, label);
      await expect(clickTarget).toHaveAttribute("data-tool-index", String(index));
      await expect(clickTarget).toHaveAttribute("data-hotkey", expectedHotkeys[index]);
      expect(await hudTool.getAttribute("data-value")).toBe(label);

      await page.keyboard.press(expectedHotkeys[index]);
      await expectActiveSelection(page, label);
      expect(await hudTool.getAttribute("data-value")).toBe(label);
    }
  });

  test("supports deselecting tools via active-button toggle and clear hotkeys", async ({ page }) => {
    await waitForAppReady(page);

    const hudTool = page.getByTestId("hud-tool-value");
    const minerButton = page.getByTestId("palette-tool-miner");
    const beltButton = page.getByTestId("palette-tool-belt");

    await page.keyboard.press("Digit3");
    await expect(hudTool).toHaveAttribute("data-value", "Splitter");
    await expectActiveSelection(page, "Splitter");

    await page.keyboard.press("Digit0");
    await expect(hudTool).toHaveAttribute("data-value", "None");
    for (const label of PALETTE) {
      await expect(page.getByRole("button", { name: label })).toHaveAttribute("data-active", "false");
    }

    await minerButton.click();
    await expectActiveSelection(page, "Miner");
    await minerButton.click();
    await expect(hudTool).toHaveAttribute("data-value", "None");
    await expect(minerButton).toHaveAttribute("data-active", "false");

    await beltButton.click();
    await expectActiveSelection(page, "Belt");
    await page.keyboard.press("Tab");
    await expectActiveSelection(page, "Splitter");
    await page.keyboard.press("Shift+Tab");
    await expectActiveSelection(page, "Belt");
  });

  test("restores tool, rotation, and pause state from saved game", async ({ page }) => {
    await waitForAppReady(page);

    const hudTool = page.getByTestId("hud-tool-value");
    const hudRotation = page.getByTestId("hud-rotation-value");
    const hudPause = page.getByTestId("hud-pause-value");
    const status = page.getByRole("status");
    const saveButton = page.getByRole("button", { name: "Save State" });
    const loadButton = page.getByRole("button", { name: "Load State" });
    const canvas = worldCanvas(page);

    await expect(hudPause).toHaveAttribute("data-value", "running");
    await page.keyboard.press("Space");
    await expect(hudPause).toHaveAttribute("data-value", "paused");

    const baselineSnapshot = await readSimSnapshot(page);
    await page.keyboard.press("Digit2");
    await rotateToDirection(page, "E");
    const target = await findPlaceableTile(page, "Belt", 1);
    await canvas.click({ position: { x: target.x, y: target.y } });
    await waitForEntityCount(page, baselineSnapshot.entityCount + 1);

    await saveButton.click();
    const saved = await readPersistedSaveState(page);
    expect(saved).not.toBeNull();

    await page.keyboard.press("Digit1");
    await rotateToDirection(page, "S");
    await page.keyboard.press("KeyR");
    await page.keyboard.press("Digit3");

    const beforeLoadSnapshot = await readSimSnapshot(page);
    await loadButton.click();
    await expect(hudTool).toHaveAttribute("data-value", "Belt");
    await expect(hudRotation).toHaveAttribute("data-value", "E");
    await expect(hudPause).toHaveAttribute("data-value", "paused");
    await expect(page.getByTestId("palette-tool-belt")).toHaveAttribute("data-active", "true");
    await expect(page.getByTestId("palette-tool-miner")).toHaveAttribute("data-active", "false");
    await expect(status).toHaveText("Loaded state.");

    const afterLoadSnapshot = await readSimSnapshot(page);
    expect(afterLoadSnapshot.entityCount).toBe(baselineSnapshot.entityCount + 1);
    expect(afterLoadSnapshot.tickCount).toBe(beforeLoadSnapshot.tickCount);

    await page.waitForTimeout(160);
    const nextSnapshot = await readSimSnapshot(page);
    expect(nextSnapshot.tickCount).toBe(afterLoadSnapshot.tickCount);
  });

  test("runtime control buttons drive pause, step, reset, and save/load/clear flows", async ({ page }) => {
    await waitForAppReady(page);

    const canvas = worldCanvas(page);
    const hudPause = page.getByTestId("hud-pause-value");
    const status = page.getByRole("status");
    const pauseButton = page.getByTestId("control-toggle-pause");
    const stepButton = page.getByTestId("control-step-tick");
    const step10Button = page.getByTestId("control-step-tick-10");
    const saveButton = page.getByTestId("control-save-state");
    const loadButton = page.getByTestId("control-load-state");
    const clearButton = page.getByTestId("control-clear-save");
    const resetButton = page.getByTestId("control-reset");

    await expect(hudPause).toHaveAttribute("data-value", "running");
    await pauseButton.click();
    await expect(hudPause).toHaveAttribute("data-value", "paused");

    const beforeStep = await readSimSnapshot(page);
    await stepButton.click();
    await expect(status).toContainText("Advanced 1 tick");
    const afterOneStep = await readSimSnapshot(page);
    expect(afterOneStep.tickCount).toBe(beforeStep.tickCount + 1);

    await stepButton.click();
    const afterTwoSteps = await readSimSnapshot(page);
    expect(afterTwoSteps.tickCount).toBe(afterOneStep.tickCount + 1);

    await pauseButton.click();
    await expect(hudPause).toHaveAttribute("data-value", "running");
    await pauseButton.click();
    await expect(hudPause).toHaveAttribute("data-value", "paused");
    const pausedSnapshot = await readSimSnapshot(page);
    await step10Button.click();
    await expect(status).toContainText("Advanced 10 ticks");
    const afterFastSteps = await readSimSnapshot(page);
    expect(afterFastSteps.tickCount).toBe(pausedSnapshot.tickCount + 10);

    await pauseButton.click();
    await expect(hudPause).toHaveAttribute("data-value", "running");
    await pauseButton.click();
    await expect(hudPause).toHaveAttribute("data-value", "paused");

    const baseline = await readSimSnapshot(page);
    await page.keyboard.press("Digit2");
    await expectActiveSelection(page, "Belt");
    const beltTile = await findPlaceableTile(page, "Belt", 1);
    await canvas.click({ position: { x: beltTile.x, y: beltTile.y } });
    await waitForEntityCount(page, baseline.entityCount + 1);

    const withPlacement = await readSimSnapshot(page);
    await saveButton.click();
    const saved = await readPersistedSaveState(page);
    expect(saved).not.toBeNull();

    await resetButton.click();
    const afterReset = await readSimSnapshot(page);
    expect(afterReset.entityCount).toBe(0);
    expect(afterReset.tickCount).toBe(0);
    await expect(hudPause).toHaveAttribute("data-value", "running");

    await loadButton.click();
    const afterLoad = await readSimSnapshot(page);
    expect(afterLoad.entityCount).toBe(withPlacement.entityCount);
    await expectActiveSelection(page, "Belt");
    expect(afterLoad.tickCount).toBe(withPlacement.tickCount);

    await clearButton.click();
    const cleared = await readPersistedSaveState(page);
    expect(cleared).toBeNull();
  });

  test("captures, restores, and clears runtime checkpoints", async ({ page }) => {
    await waitForAppReady(page);
    await clearRuntimeCheckpointStorage(page);

    const hudPause = page.getByTestId("hud-pause-value");
    const status = page.getByRole("status");
    const pauseButton = page.getByTestId("control-toggle-pause");
    const checkpointCapture = page.getByTestId("control-checkpoint-capture");
    const checkpointClear = page.getByTestId("control-checkpoints-clear");
    const checkpointEmpty = page.getByTestId("control-checkpoint-empty");
    const checkpointList = page.getByTestId("control-checkpoint-list");
    const canvas = worldCanvas(page);

    await expect(checkpointEmpty).toBeVisible();
    await pauseButton.click();
    await expect(hudPause).toHaveAttribute("data-value", "paused");

    const baseline = await readSimSnapshot(page);
    await checkpointCapture.click();
    await expect(status).toContainText("Checkpoint captured");

    const firstItem = page.getByTestId("control-checkpoint-item-0");
    await expect(firstItem).toBeVisible();
    await expect(checkpointList).toContainText("tick " + baseline.tick);

    const beltTile = await findPlaceableTile(page, "Belt", 1);
    await page.keyboard.press("Digit2");
    await canvas.click({ position: { x: beltTile.x, y: beltTile.y } });
    await waitForEntityCount(page, baseline.entityCount + 1);

    const afterPlacement = await readSimSnapshot(page);
    expect(afterPlacement.entityCount).toBe(baseline.entityCount + 1);

    const restoreButton = page.getByTestId("control-checkpoint-restore-0");
    await restoreButton.click();
    await expect(status).toContainText("Restored checkpoint");
    const afterRestore = await readSimSnapshot(page);
    expect(afterRestore.entityCount).toBe(baseline.entityCount);

    const rawAfterCapture = await readRawCheckpointPayload(page);
    expect(rawAfterCapture).not.toBeNull();

    await checkpointClear.click();
    await expect(status).toContainText("Runtime checkpoints cleared.");
    await expect(checkpointEmpty).toBeVisible();

    const rawAfterClear = await readRawCheckpointPayload(page);
    expect(rawAfterClear).toBeNull();
  });

  test("loads a persisted runtime checkpoint after reload", async ({ page }) => {
    await waitForAppReady(page);
    await clearRuntimeCheckpointStorage(page);

    const status = page.getByRole("status");
    const pauseButton = page.getByTestId("control-toggle-pause");
    const hudPause = page.getByTestId("hud-pause-value");
    const checkpointCapture = page.getByTestId("control-checkpoint-capture");
    const checkpointRestore = page.getByTestId("control-checkpoint-restore-0");
    const canvas = worldCanvas(page);

    await pauseButton.click();
    await expect(hudPause).toHaveAttribute("data-value", "paused");

    const checkpointBaseline = await readSimSnapshot(page);
    await checkpointCapture.click();
    await expect(status).toContainText("Checkpoint captured");

    const beforeReload = await readSimSnapshot(page);
    await expect(checkpointCapture).toBeEnabled();

    const firstItem = page.getByTestId("control-checkpoint-item-0");
    await expect(firstItem).toBeVisible();

    const beltTile = await findPlaceableTile(page, "Belt", 1);
    await page.keyboard.press("Digit2");
    await canvas.click({ position: { x: beltTile.x, y: beltTile.y } });
    await waitForEntityCount(page, beforeReload.entityCount + 1);

    const persisted = await readRawCheckpointPayload(page);
    expect(persisted).not.toBeNull();

    await page.reload();
    await waitForAppReady(page);

    await expect(firstItem).toBeVisible();
    await expect(page.getByTestId("control-checkpoint-list")).toContainText(`tick ${checkpointBaseline.tick}`);

    const afterReloadBaseline = await readSimSnapshot(page);
    const secondTile = await findPlaceableTile(page, "Belt", 1);
    await page.keyboard.press("Digit2");
    await canvas.click({ position: { x: secondTile.x, y: secondTile.y } });
    await waitForEntityCount(page, afterReloadBaseline.entityCount + 1);

    await checkpointRestore.click();
    await expect(status).toContainText("Restored checkpoint");
    const afterRestore = await readSimSnapshot(page);
    expect(afterRestore.entityCount).toBe(checkpointBaseline.entityCount);
  });

  test("clears invalid checkpoint payloads from localStorage", async ({ page }) => {
    await waitForAppReady(page);
    await clearRuntimeCheckpointStorage(page);

    await writeRawCheckpointPayload(page, "{not-json");

    await page.reload();
    await waitForAppReady(page);

    const empty = page.getByTestId("control-checkpoint-empty");
    await expect(empty).toBeVisible();
    const persisted = await readRawCheckpointPayload(page);
    expect(persisted).toBeNull();
  });

  test("supports clearing and rebuilding action history", async ({ page }) => {
    await waitForAppReady(page);

    const canvas = worldCanvas(page);
    const undo = page.getByTestId("control-undo");
    const redo = page.getByTestId("control-redo");
    const clearHistory = page.getByTestId("control-clear-history");
    const baseline = await readSimSnapshot(page);

    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();

    await page.keyboard.press("Digit2");
    const beltTile = await findPlaceableTile(page, "Belt", 1);
    await canvas.click({ position: { x: beltTile.x, y: beltTile.y } });
    await waitForEntityCount(page, baseline.entityCount + 1);

    await expect(undo).toBeEnabled();
    await undo.click();
    await waitForEntityCount(page, baseline.entityCount);
    await expect(undo).toBeDisabled();

    await clearHistory.click();
    await waitForEntityCount(page, baseline.entityCount);
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
  });

  test("imports a runtime blueprint payload anchored to the current player", async ({ page }) => {
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const blueprintImportInput = page.getByTestId("control-blueprint-import-input");
    const before = await readSimSnapshot(page);

    const blueprint = {
      version: 1,
      anchor: { x: 0, y: 0 },
      entities: [
        {
          kind: "belt",
          x: 1,
          y: 0,
          rot: "E",
        },
      ],
    };

    await blueprintImportInput.setInputFiles({
      name: "runtime-blueprint.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(blueprint)),
    });

    await expect(status).toContainText("Blueprint imported");
    await waitForEntityCount(page, before.entityCount + 1);
  });

  test("prevents blueprint import when placement blockers are present", async ({ page }) => {
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const blueprintImportInput = page.getByTestId("control-blueprint-import-input");
    const before = await readSimSnapshot(page);

    const blueprint = {
      version: 1,
      anchor: {
        x: 0,
        y: 0,
      },
      entities: [
        {
          kind: "belt",
          x: -1000,
          y: 0,
          rot: "N",
        },
      ],
    };

    await blueprintImportInput.setInputFiles({
      name: "runtime-blueprint-blocked.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(blueprint)),
    });

    await expect(status).toContainText("Blueprint import blocked");
    await expect(status).toContainText("out-of-bounds");
    await waitForEntityCount(page, before.entityCount);
  });

  test("imports and executes a runtime plan", async ({ page }) => {
    await waitForAppReady(page);

    const baseline = await readSimSnapshot(page);
    const status = page.getByRole("status");
    const planImportInput = page.getByTestId("control-plan-import-input");
    const planStart = page.getByTestId("control-plan-start");
    const planStop = page.getByTestId("control-plan-stop");
    const planClear = page.getByTestId("control-plan-clear");
    const planProgress = page.getByTestId("control-plan-progress");
    const planStatus = page.getByTestId("control-plan-status");

    const target = await findPlaceableTile(page, "Belt", 1);
    await expect(planStart).toBeDisabled();

    const planPayload = {
      version: 1,
      name: "smoke-plan",
      commands: [
        {
          type: "place",
          tool: "belt",
          x: target.tileX,
          y: target.tileY,
          rotation: 1,
        },
        {
          type: "step",
          ticks: 1,
        },
        {
          type: "remove",
          tool: "belt",
          x: target.tileX,
          y: target.tileY,
        },
      ],
    };

    await planImportInput.setInputFiles({
      name: "agent-plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(planPayload)),
    });

    await expect(status).toContainText("Plan imported.");
    await expect(planStart).toBeEnabled();
    await expect(planProgress).toContainText("0/3");

    await planStart.click({ force: true });
    await expect(planStop).toBeEnabled();
    await expect
      .poll(async () => {
        return planProgress.textContent();
      })
      .toContain("1/3");
    const afterPlace = await readSimSnapshot(page);
    expect(afterPlace.entityCount).toBe(baseline.entityCount + 1);

    await expect
      .poll(async () => {
        return planProgress.textContent();
      })
      .toContain("3/3");

    const afterPlan = await readSimSnapshot(page);
    expect(afterPlan.entityCount).toBe(baseline.entityCount);
    await expect(planStop).toBeDisabled();
    await expect(planStatus).toContainText("Plan complete.");

    await planClear.click();
    await expect(planStart).toBeDisabled();
  });

  test("steps a runtime plan command manually", async ({ page }) => {
    await waitForAppReady(page);

    const baseline = await readSimSnapshot(page);
    const status = page.getByRole("status");
    const planImportInput = page.getByTestId("control-plan-import-input");
    const planStep = page.getByTestId("control-plan-step");
    const planProgress = page.getByTestId("control-plan-progress");

    const target = await findPlaceableTile(page, "Belt", 1);
    const planPayload = {
      version: 1,
      name: "step-plan",
      commands: [
        {
          type: "place",
          tool: "belt",
          x: target.tileX,
          y: target.tileY,
          rotation: 0,
        },
        {
          type: "step",
          ticks: 1,
        },
      ],
    };

    await planImportInput.setInputFiles({
      name: "step-plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(planPayload)),
    });

    await expect(status).toContainText("Plan imported");
    await expect(planStep).toBeEnabled();

    const afterImport = await readSimSnapshot(page);
    expect(afterImport.entityCount).toBe(baseline.entityCount);

    await planStep.click();
    await expect(planProgress).toContainText("1/2");
    const afterFirstStep = await readSimSnapshot(page);
    expect(afterFirstStep.entityCount).toBe(baseline.entityCount + 1);

    await planStep.click();
    await expect(planProgress).toContainText("2/2");
    await expect(status).toContainText("Plan complete.");
  });

  test("loops a runtime plan when loop mode is enabled", async ({ page }) => {
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const planImportInput = page.getByTestId("control-plan-import-input");
    const planLoop = page.getByTestId("control-plan-loop");
    const planStart = page.getByTestId("control-plan-start");
    const planStop = page.getByTestId("control-plan-stop");
    const planProgress = page.getByTestId("control-plan-progress");

    const target = await findPlaceableTile(page, "Belt", 1);
    const planPayload = {
      version: 1,
      name: "looping-plan",
      commands: [
        {
          type: "place",
          tool: "belt",
          x: target.tileX,
          y: target.tileY,
          rotation: 0,
        },
        {
          type: "step",
          ticks: 1,
        },
        {
          type: "remove",
          tool: "belt",
          x: target.tileX,
          y: target.tileY,
        },
      ],
    };

    await planImportInput.setInputFiles({
      name: "agent-plan-loop.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(planPayload)),
    });

    await expect(status).toContainText("Plan imported");
    await expect(planStart).toBeEnabled();

    await planLoop.check();
    await expect(planLoop).toBeChecked();
    await expect(planProgress).toContainText("0/3");

    await planStart.click({ force: true });
    await expect(planStop).toBeEnabled();

    await expect
      .poll(async () => {
        return planProgress.textContent();
      })
      .toContain("3/3");
    await expect
      .poll(async () => {
        return planProgress.textContent();
      })
      .toContain("0/3");
    await expect
      .poll(async () => {
        return planProgress.textContent();
      })
      .toContain("1/3");

    await planStop.click();
    await expect(planStop).toBeDisabled();
  });

  test("records gameplay actions into a runtime plan and replays them", async ({ page }) => {
    await waitForAppReady(page);

    const baseline = await readSimSnapshot(page);
    const status = page.getByRole("status");
    const canvas = worldCanvas(page);
    const record = page.getByTestId("control-plan-record");
    const planStart = page.getByTestId("control-plan-start");
    const planStop = page.getByTestId("control-plan-stop");
    const planProgress = page.getByTestId("control-plan-progress");

    await expect(record).toBeEnabled();

    const target = await findPlaceableTile(page, "Belt", 1);

    await record.click();
    await expect(record).toContainText("Stop Recording");
    await expect(planStart).toBeDisabled();
    await expect(status).toContainText("Runtime plan recording started.");

    await page.keyboard.press("Digit2");
    await expectActiveSelection(page, "Belt");

    await canvas.click({ position: { x: target.x, y: target.y } });
    await waitForEntityCount(page, baseline.entityCount + 1);

    await page.keyboard.press("KeyR");
    await canvas.click({ position: { x: target.x, y: target.y }, button: "right" });
    await waitForEntityCount(page, baseline.entityCount);

    await record.click();
    await expect(planStart).toBeEnabled();
    await expect(planProgress).toContainText("0/3");

    await planStart.click({ force: true });
    await expect
      .poll(async () => {
        return planProgress.textContent();
      })
      .toContain("3/3");

    const afterReplay = await readSimSnapshot(page);
    expect(afterReplay.entityCount).toBe(baseline.entityCount);
    await expect(planStop).toBeDisabled();
    await expect(status).toContainText("Plan complete.");
  });

  test("records gameplay actions with a custom agent tag", async ({ page }) => {
    await waitForAppReady(page);
    await clearRuntimePlanStorage(page);

    const baseline = await readSimSnapshot(page);
    const canvas = worldCanvas(page);
    const record = page.getByTestId("control-plan-record");
    const recordAgent = page.getByTestId("control-plan-record-agent");
    const planStart = page.getByTestId("control-plan-start");
    const planProgress = page.getByTestId("control-plan-progress");

    const target = await findPlaceableTile(page, "Belt", 1);

    await recordAgent.fill("planner");
    await record.click();
    await page.keyboard.press("Digit2");
    await canvas.click({ position: { x: target.x, y: target.y } });
    await waitForEntityCount(page, baseline.entityCount + 1);
    await record.click();

    const rawPlan = await readRawPlanPayload(page);
    expect(rawPlan).not.toBeNull();

    const parsedPlan = JSON.parse(rawPlan as string) as {
      commands: Array<{ type: string; agent?: string }>;
    };
    expect(parsedPlan.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "place",
          agent: "planner",
        }),
      ]),
    );

    await expect(planProgress).toContainText("0/1");
    await planStart.click({ force: true });
    await expect
      .poll(async () => {
        return planProgress.textContent();
      })
      .toContain("1/1");

    const afterReplay = await readSimSnapshot(page);
    expect(afterReplay.entityCount).toBe(baseline.entityCount);
  });

  test("interleaves multi-agent runtime plan commands by agent round-robin", async ({ page }) => {
    await waitForAppReady(page);

    const planImportInput = page.getByTestId("control-plan-import-input");
    const planStart = page.getByTestId("control-plan-start");
    const planProgress = page.getByTestId("control-plan-progress");
    const planStatus = page.getByTestId("control-plan-status");
    const rotationValue = page.getByTestId("hud-rotation-value");

    const planPayload = {
      version: 1,
      name: "agent-round-robin-plan",
      commands: [
        {
          type: "set-rotation",
          rotation: 1,
          agent: "planner",
        },
        {
          type: "set-rotation",
          rotation: 2,
          agent: "builder",
        },
        {
          type: "set-rotation",
          rotation: 3,
          agent: "builder",
        },
        {
          type: "set-rotation",
          rotation: 0,
          agent: "planner",
        },
      ],
    };

    await planImportInput.setInputFiles({
      name: "agent-plan-round-robin.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(planPayload)),
    });

    await expect(planStart).toBeEnabled();
    await expect(planProgress).toContainText("0/4");
    await planStart.click({ force: true });

    await expect
      .poll(async () => {
        return planProgress.textContent();
      })
      .toContain("4/4");
    await expect(planStatus).toContainText("Plan complete.");
    await expect(rotationValue).toHaveAttribute("data-value", "W");
  });

  test("runtime plans can reorder agent execution order", async ({ page }) => {
    await waitForAppReady(page);

    const planImportInput = page.getByTestId("control-plan-import-input");
    const planStart = page.getByTestId("control-plan-start");
    const planProgress = page.getByTestId("control-plan-progress");
    const planStatus = page.getByTestId("control-plan-status");
    const planLog = page.getByTestId("control-plan-log");

    const planPayload = {
      version: 1,
      name: "agent-order-plan",
      commands: [
        {
          type: "set-rotation",
          rotation: 1,
          agent: "builder",
        },
        {
          type: "set-rotation",
          rotation: 2,
          agent: "planner",
        },
        {
          type: "set-agent-order",
          order: ["planner", "builder"],
          agent: "builder",
        },
        {
          type: "set-rotation",
          rotation: 3,
          agent: "builder",
        },
        {
          type: "set-rotation",
          rotation: 0,
          agent: "planner",
        },
      ],
    };

    await planImportInput.setInputFiles({
      name: "agent-order-plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(planPayload)),
    });

    await expect(planStart).toBeEnabled();
    await expect(planProgress).toContainText("0/5");
    await planStart.click({ force: true });

    await expect
      .poll(async () => {
        return planProgress.textContent();
      })
      .toContain("5/5");
    await expect(planStatus).toContainText("Plan complete.");
    await expect(planLog).toContainText("set agent order planner -> builder");
    await expect(rotationValue).toHaveAttribute("data-value", "W");
  });

  test("runtime plans can set per-agent execution speed", async ({ page }) => {
    await waitForAppReady(page);

    const planImportInput = page.getByTestId("control-plan-import-input");
    const planStart = page.getByTestId("control-plan-start");
    const planProgress = page.getByTestId("control-plan-progress");
    const planStatus = page.getByTestId("control-plan-status");
    const planLog = page.getByTestId("control-plan-log");
    const rotationValue = page.getByTestId("hud-rotation-value");

    const planPayload = {
      version: 1,
      name: "agent-speed-plan",
      commands: [
        {
          type: "set-plan-speed",
          delayMs: 150,
        },
        {
          type: "set-agent-speed",
          targetAgent: "builder",
          delayMs: 250,
          agent: "planner",
        },
        {
          type: "set-agent-speed",
          targetAgent: "planner",
          delayMs: 60,
        },
        {
          type: "set-rotation",
          rotation: 1,
          agent: "planner",
        },
        {
          type: "set-rotation",
          rotation: 2,
          agent: "builder",
        },
      ],
    };

    await planImportInput.setInputFiles({
      name: "agent-speed-plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(planPayload)),
    });

    await expect(planStart).toBeEnabled();
    await expect(planProgress).toContainText("0/5");
    await planStart.click({ force: true });

    await expect
      .poll(async () => {
        return planProgress.textContent();
      })
      .toContain("5/5");
    await expect(planStatus).toContainText("Plan complete.");
    await expect(planLog).toContainText("set plan speed 150ms");
    await expect(planLog).toContainText("builder speed set to 250ms");
    await expect(planLog).toContainText("planner speed set to 60ms");
  });

  test("runtime plans can enable and disable plan agents dynamically", async ({ page }) => {
    await waitForAppReady(page);

    const planImportInput = page.getByTestId("control-plan-import-input");
    const planStart = page.getByTestId("control-plan-start");
    const planProgress = page.getByTestId("control-plan-progress");
    const planStatus = page.getByTestId("control-plan-status");
    const planLog = page.getByTestId("control-plan-log");
    const rotationValue = page.getByTestId("hud-rotation-value");

    const planPayload = {
      version: 1,
      name: "agent-toggle-plan",
      commands: [
        {
          type: "set-rotation",
          rotation: 1,
          agent: "planner",
        },
        {
          type: "set-rotation",
          rotation: 2,
          agent: "builder",
        },
        {
          type: "disable-agent",
          targetAgent: "builder",
          agent: "planner",
        },
        {
          type: "set-rotation",
          rotation: 3,
          agent: "builder",
        },
        {
          type: "set-rotation",
          rotation: 0,
          agent: "planner",
        },
      ],
    };

    await planImportInput.setInputFiles({
      name: "agent-toggle-plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(planPayload)),
    });

    await expect(planStart).toBeEnabled();
    await expect(planProgress).toContainText("0/5");
    await planStart.click({ force: true });

    await expect
      .poll(async () => {
        return planProgress.textContent();
      })
      .toContain("4/5");
    await expect(planStatus).toContainText("Plan complete.");
    await expect(rotationValue).toHaveAttribute("data-value", "N");
    await expect(planLog).toContainText("builder disabled in plan execution.");
  });

  test("runtime plans can control automation agents", async ({ page }) => {
    await waitForAppReady(page);

    const planImportInput = page.getByTestId("control-plan-import-input");
    const planStart = page.getByTestId("control-plan-start");
    const planProgress = page.getByTestId("control-plan-progress");
    const planStatus = page.getByTestId("control-plan-status");
    const planLog = page.getByTestId("control-plan-log");
    const autoPickupCheckbox = page.getByRole("checkbox", { name: /Auto Pickup/ });
    const autoDepositCheckbox = page.getByRole("checkbox", { name: /Auto Deposit/ });

    if (await autoPickupCheckbox.isChecked()) {
      await autoPickupCheckbox.uncheck();
    }
    if (await autoDepositCheckbox.isChecked()) {
      await autoDepositCheckbox.uncheck();
    }

    const planPayload = {
      version: 1,
      name: "automation-plan",
      commands: [
        {
          type: "enable-automation",
          automationAgent: "auto-pickup",
        },
        {
          type: "disable-automation",
          automationAgentId: "deposit",
        },
        {
          type: "disable-automation",
          automationAgent: "auto-pickup",
        },
      ],
    };

    await planImportInput.setInputFiles({
      name: "automation-plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(planPayload)),
    });

    await expect(planStart).toBeEnabled();
    await expect(planProgress).toContainText("0/3");
    await planStart.click({ force: true });

    await expect
      .poll(async () => {
        return planProgress.textContent();
      })
      .toContain("3/3");
    await expect(planStatus).toContainText("Plan complete.");
    await expect(autoPickupCheckbox).not.toBeChecked();
    await expect(autoDepositCheckbox).not.toBeChecked();
    await expect(planLog).toContainText("auto-pickup enabled in plan execution.");
    await expect(planLog).toContainText("auto-deposit disabled in plan execution.");
    await expect(planLog).toContainText("auto-pickup disabled in plan execution.");
  });

  test("runtime plan can change execution speed", async ({ page }) => {
    await waitForAppReady(page);

    const planImportInput = page.getByTestId("control-plan-import-input");
    const planStart = page.getByTestId("control-plan-start");
    const planStep = page.getByTestId("control-plan-step");
    const planProgress = page.getByTestId("control-plan-progress");
    const planSpeedValue = page.getByTestId("control-plan-speed-value");
    const rotationValue = page.getByTestId("hud-rotation-value");

    const planPayload = {
      version: 1,
      name: "speed-plan",
      commands: [
        {
          type: "set-plan-speed",
          delayMs: 400,
        },
        {
          type: "set-rotation",
          rotation: 1,
        },
        {
          type: "set-rotation",
          rotation: 2,
        },
      ],
    };

    await planImportInput.setInputFiles({
      name: "speed-plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(planPayload)),
    });

    await expect(planStart).toBeEnabled();
    await expect(planProgress).toContainText("0/3");

    await planStep.click();
    await expect(planSpeedValue).toContainText("400ms");

    await planStart.click({ force: true });
    await expect
      .poll(async () => {
        return planProgress.textContent();
      })
      .toContain("3/3");
    await expect(rotationValue).toHaveAttribute("data-value", "S");
  });

  test("copies and pastes runtime plans via clipboard", async ({ page }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const planImportInput = page.getByTestId("control-plan-import-input");
    const planCopy = page.getByTestId("control-plan-copy");
    const planPaste = page.getByTestId("control-plan-paste");
    const planClear = page.getByTestId("control-plan-clear");
    const planStart = page.getByTestId("control-plan-start");
    const planProgress = page.getByTestId("control-plan-progress");

    const planPayload = {
      version: 1,
      name: "clipboard-plan",
      commands: [
        {
          type: "set-rotation",
          rotation: 1,
        },
        {
          type: "step",
          ticks: 1,
        },
      ],
    };

    await expect(planCopy).toBeDisabled();

    await planImportInput.setInputFiles({
      name: "clipboard-plan.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(planPayload)),
    });

    await expect(status).toContainText("Plan imported");
    await expect(planCopy).toBeEnabled();
    await planCopy.click();
    await expect(status).toContainText("Plan copied to clipboard.");

    await expect(page.evaluate(async () => navigator.clipboard.readText())).resolves.toContain('"clipboard-plan"');

    await clearRuntimePlanStorage(page);
    await planClear.click();
    await expect(planStart).toBeDisabled();
    await expect(planProgress).toHaveText("Progress: 0/0");

    await planPaste.click();
    await expect(status).toContainText("Plan imported");
    await expect(planStart).toBeEnabled();
    await expect(planProgress).toHaveText("Progress: 0/2");
  });

  test("invalid runtime plan payload from storage is rejected", async ({ page }) => {
    await waitForAppReady(page);
    await clearRuntimePlanStorage(page);
    await writeRawPlanPayload(page, "{invalid-json");
    await page.reload();
    const status = page.getByRole("status");
    await expect(status).toContainText(/invalid/i);
    await waitForAppReady(page);

    const planStart = page.getByTestId("control-plan-start");
    const planProgress = page.getByTestId("control-plan-progress");
    const rawPlan = await readRawPlanPayload(page);
    expect(rawPlan).toBeNull();
    await expect(planStart).toBeDisabled();
    await expect(planProgress).toContainText("0/0");
  });

  test("loading runtime plan with newer schema surfaces warning", async ({ page }) => {
    await waitForAppReady(page);
    await clearRuntimePlanStorage(page);
    await writeRawPlanPayload(
      page,
      JSON.stringify({
        schemaVersion: 99,
        version: 1,
        commands: [
          {
            type: "pause",
          },
        ],
      }),
    );
    await page.reload();
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const planStart = page.getByTestId("control-plan-start");

    await expect(status).toContainText("Loaded stored plan");
    await expect(status).toContainText("newer than the current app schema");
    await expect(planStart).toBeEnabled();
  });

  test("clears corrupted primary save data on load and reports invalid state", async ({ page }) => {
    await waitForAppReady(page);

    const saveButton = page.getByTestId("control-save-state");
    const loadButton = page.getByTestId("control-load-state");
    const status = page.getByRole("status");

    await saveButton.click();
    const persisted = await readRawSavePayload(page);
    expect(persisted).not.toBeNull();

    await writeRawSavePayload(page, "{invalid-json");
    await loadButton.click();
    await expect(status).toContainText(/invalid/i);

    const rawAfterLoad = await readRawSavePayload(page);
    expect(rawAfterLoad).toBeNull();
  });

  test("supports save-slot save/load/clear with active-slot cycling", async ({ page }) => {
    await waitForAppReady(page);

    await clearSaveSlots(page);
    await page.reload();
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const slotLoad = page.getByTestId("control-slot-load");
    const slotSave = page.getByTestId("control-slot-save");
    const slotClear = page.getByTestId("control-slot-clear");
    const slotUpdatedAt = page.getByTestId("control-slot-updated-at");
    const slotNext = page.getByTestId("control-slot-next");
    const slotPrev = page.getByTestId("control-slot-prev");
    const slotActive = page.getByTestId("control-slot-active");

    await expect(slotActive).toHaveText("slot 1/3");
    await expect(slotLoad).toBeDisabled();
    await expect(slotClear).toBeDisabled();
    await expect(slotUpdatedAt).toHaveText("slot empty");

    const slotStateAfterBoot = await readSaveSlotState(page);
    expect(slotStateAfterBoot[0]?.hasValue).toBe(false);
    expect(slotStateAfterBoot[1]?.hasValue).toBe(false);
    expect(slotStateAfterBoot[2]?.hasValue).toBe(false);

    const baselineCount = await readEntityCount(page);
    const placementA = await findPlaceableTile(page, "Belt", 0);
    await placeEntityAt(page, "Belt", placementA.tileX, placementA.tileY);
    await waitForEntityCount(page, baselineCount + 1);

    await slotSave.click();
    await expect(status).toContainText("State saved to slot 1.");
    await expect(slotUpdatedAt).toContainText("saved ");
    const slotStateAfterSlotOneSave = await readSaveSlotState(page);
    expect(slotStateAfterSlotOneSave[0]?.hasValue).toBe(true);

    const placementB = await findPlaceableTile(page, "Belt", 0);
    await placeEntityAt(page, "Belt", placementB.tileX, placementB.tileY);
    await waitForEntityCount(page, baselineCount + 2);

    await slotNext.click();
    await expect(slotActive).toHaveText("slot 2/3");
    const placementC = await findPlaceableTile(page, "Belt", 0);
    await placeEntityAt(page, "Belt", placementC.tileX, placementC.tileY);
    await waitForEntityCount(page, baselineCount + 3);

    await slotSave.click();
    await expect(status).toContainText("State saved to slot 2.");
    await expect(slotUpdatedAt).toContainText("saved ");
    const slotStateAfterSlotTwoSave = await readSaveSlotState(page);
    expect(slotStateAfterSlotTwoSave[1]?.hasValue).toBe(true);

    await slotPrev.click();
    await expect(slotActive).toHaveText("slot 1/3");
    await slotLoad.click();
    await waitForEntityCount(page, baselineCount + 1);
    await expect(status).toContainText("Loaded slot 1.");

    await slotNext.click();
    await expect(slotActive).toHaveText("slot 2/3");
    await slotLoad.click();
    await waitForEntityCount(page, baselineCount + 3);
    await expect(status).toContainText("Loaded slot 2.");

    await slotClear.click();
    await expect(status).toContainText("Cleared slot 2.");
    await expect(slotLoad).toBeDisabled();
    await expect(slotClear).toBeDisabled();
    await expect(slotUpdatedAt).toHaveText("slot empty");

    await slotNext.click();
    await expect(slotActive).toHaveText("slot 3/3");
    await slotPrev.click();
    await slotPrev.click();
    await expect(slotActive).toHaveText("slot 1/3");
  });

  test("loading from a save slot resets tutorial mission progress", async ({ page }) => {
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const slotSave = page.getByTestId("control-slot-save");
    const slotLoad = page.getByTestId("control-slot-load");
    const slotActive = page.getByTestId("control-slot-active");

    await clearSaveSlots(page);
    await page.reload();
    await waitForAppReady(page);

    await enableTutorialMode(page);
    await expectNextTutorialMissionToContain(page, "Move the player");

    const moved = await movePlayerOneStep(page);
    if (moved !== true) {
      throw new Error("Unable to move player during save-slot tutorial reset regression test");
    }
    await expectNextTutorialMissionToContain(page, "Choose a build tool");

    await slotSave.click();
    await expect(status).toContainText("State saved to slot 1.");
    await expect(slotActive).toHaveText("slot 1/3");

    await slotLoad.click();
    await expect(status).toContainText("Loaded slot 1.");
    await expectNextTutorialMissionToContain(page, "Move the player");
  });

  test("cycles save slots with keyboard shortcuts", async ({ page }) => {
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const slotSave = page.getByTestId("control-slot-save");
    const slotActive = page.getByTestId("control-slot-active");

    await clearSaveSlots(page);
    await page.reload();
    await waitForAppReady(page);

    await expect(slotActive).toHaveText("slot 1/3");
    await slotSave.click();
    await expect(status).toContainText("State saved to slot 1.");

    await page.keyboard.press("Equal");
    await expect(slotActive).toHaveText("slot 2/3");
    await page.keyboard.press("Equal");
    await expect(slotActive).toHaveText("slot 3/3");
    await page.keyboard.press("Equal");
    await expect(slotActive).toHaveText("slot 1/3");

    await page.keyboard.press("Minus");
    await expect(slotActive).toHaveText("slot 3/3");
    await page.keyboard.press("Minus");
    await expect(slotActive).toHaveText("slot 2/3");
    await page.keyboard.press("Equal");
    await expect(slotActive).toHaveText("slot 3/3");
  });

  test("quick-selects and quick-saves load slots with modifiers", async ({ page }) => {
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const slotSave = page.getByTestId("control-slot-save");
    const slotLoad = page.getByTestId("control-slot-load");
    const slotActive = page.getByTestId("control-slot-active");

    await clearSaveSlots(page);
    await page.reload();
    await waitForAppReady(page);

    await expect(slotActive).toHaveText("slot 1/3");
    await expect(slotLoad).toBeDisabled();

    const baselineCount = await readEntityCount(page);
    const placementA = await findPlaceableTile(page, "Belt", 0);
    await placeEntityAt(page, "Belt", placementA.tileX, placementA.tileY);
    await waitForEntityCount(page, baselineCount + 1);

    await page.keyboard.press("Control+Shift+Digit1");
    await expect(status).toContainText("State saved to slot 1.");

    const placementB = await findPlaceableTile(page, "Belt", 0);
    await placeEntityAt(page, "Belt", placementB.tileX, placementB.tileY);
    await waitForEntityCount(page, baselineCount + 2);

    await page.keyboard.press("Control+Digit2");
    await expect(slotActive).toHaveText("slot 2/3");

    await page.keyboard.press("Control+Shift+Digit2");
    await expect(status).toContainText("State saved to slot 2.");

    await page.keyboard.press("Alt+Digit1");
    await expect(status).toContainText("Loaded slot 1.");
    await waitForEntityCount(page, baselineCount + 1);

    await page.keyboard.press("Alt+Digit2");
    await expect(status).toContainText("Loaded slot 2.");
    await waitForEntityCount(page, baselineCount + 2);

    await page.keyboard.press("Control+Digit1");
    await expect(slotActive).toHaveText("slot 1/3");
    await expect(status).toContainText("Active save slot: 1.");
  });

  test("ignores corrupted save-slot payloads for load/clear actions", async ({ page }) => {
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const slotSave = page.getByTestId("control-slot-save");
    const slotLoad = page.getByTestId("control-slot-load");
    const slotClear = page.getByTestId("control-slot-clear");
    const slotNext = page.getByTestId("control-slot-next");
    const slotActive = page.getByTestId("control-slot-active");

    await clearSaveSlots(page);
    await page.reload();
    await waitForAppReady(page);

    const baselineCount = await readEntityCount(page);
    const placement = await findPlaceableTile(page, "Belt", 0);
    await placeEntityAt(page, "Belt", placement.tileX, placement.tileY);
    await waitForEntityCount(page, baselineCount + 1);

    await slotSave.click();
    await expect(status).toContainText("State saved to slot 1.");
    await expect(slotLoad).toBeEnabled();
    await expect(slotClear).toBeEnabled();

    await writeRawSaveSlotPayload(page, 1, "{not-json");

    await page.reload();
    await waitForAppReady(page);

    await expect(slotActive).toHaveText("slot 1/3");
    await expect(slotLoad).toBeEnabled();
    await expect(slotClear).toBeEnabled();

    await slotNext.click();
    await expect(slotActive).toHaveText("slot 2/3");
    await expect(slotLoad).toBeDisabled();
    await expect(slotClear).toBeDisabled();
  });

  test("keeps corrupted slot metadata disabled when payload cannot be parsed", async ({ page }) => {
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const slotSave = page.getByTestId("control-slot-save");
    const slotLoad = page.getByTestId("control-slot-load");
    const slotClear = page.getByTestId("control-slot-clear");

    await clearSaveSlots(page);
    await page.reload();
    await waitForAppReady(page);

    const baselineCount = await readEntityCount(page);
    const placement = await findPlaceableTile(page, "Belt", 0);
    await placeEntityAt(page, "Belt", placement.tileX, placement.tileY);
    await waitForEntityCount(page, baselineCount + 1);
    await slotSave.click();
    await expect(status).toContainText("State saved to slot 1.");

    await writeRawSaveSlotPayload(page, 0, "not-json");
    await page.reload();
    await waitForAppReady(page);

    const raw = await readRawSaveSlotPayload(page, 0);
    expect(raw).toBeNull();

    await expect(slotLoad).toBeDisabled();
    await expect(slotClear).toBeDisabled();
  });

  test("disabled slot actions update immediately after loading a corrupted active slot payload", async ({ page }) => {
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const slotSave = page.getByTestId("control-slot-save");
    const slotLoad = page.getByTestId("control-slot-load");
    const slotClear = page.getByTestId("control-slot-clear");

    await clearSaveSlots(page);
    await slotSave.click();
    await expect(status).toContainText("State saved to slot 1.");
    await expect(slotLoad).toBeEnabled();
    await writeRawSaveSlotPayload(page, 0, "{not-json");

    await slotLoad.click();
    await expect(status).toContainText(/invalid/i);
    await expect(slotLoad).toBeDisabled();
    await expect(slotClear).toBeDisabled();

    const raw = await readRawSaveSlotPayload(page, 0);
    expect(raw).toBeNull();
  });

  test("restores load/clear availability when a slot receives a valid state payload", async ({ page }) => {
    await waitForAppReady(page);

    const status = page.getByRole("status");
    const slotLoad = page.getByTestId("control-slot-load");
    const slotClear = page.getByTestId("control-slot-clear");

    await clearSaveSlots(page);
    await writeRawSaveSlotPayload(page, 0, "not-json");
    await page.reload();
    await waitForAppReady(page);
    await expect(slotLoad).toBeDisabled();
    await expect(slotClear).toBeDisabled();

    await writeSaveSlotPayload(page, 0, {
      ...VALID_SLOT_STATE,
      createdAt: new Date().toISOString(),
    });
    await page.reload();
    await waitForAppReady(page);

    await expect(slotLoad).toBeEnabled();
    await expect(slotClear).toBeEnabled();
    await slotLoad.click();
    await expect(status).toContainText("Loaded slot 1.");
  });

  test("runtime keyboard shortcuts include P pause toggle and shift step", async ({ page }) => {
    await waitForAppReady(page);

    const hudPause = page.getByTestId("hud-pause-value");
    const status = page.getByRole("status");

    await expect(hudPause).toHaveAttribute("data-value", "running");
    await page.keyboard.press("KeyP");
    await expect(hudPause).toHaveAttribute("data-value", "paused");

    const pausedBaseline = await readSimSnapshot(page);
    await page.keyboard.press("Slash");
    const afterSingleStep = await readSimSnapshot(page);
    expect(afterSingleStep.tickCount).toBe(pausedBaseline.tickCount + 1);

    await page.keyboard.down("Shift");
    await page.keyboard.press("Slash");
    await page.keyboard.up("Shift");
    const afterFastStep = await readSimSnapshot(page);
    expect(afterFastStep.tickCount).toBe(afterSingleStep.tickCount + 10);
    await expect(status).toContainText("Advanced 10 ticks");

    await page.keyboard.press("KeyP");
    await expect(hudPause).toHaveAttribute("data-value", "running");
  });

  test("minimap click recenters camera on selected world tile", async ({ page }) => {
    await waitForAppReady(page);

    const minimap = page.getByTestId("world-minimap");
    const targetTile = { x: 10, y: 10 };
    const initialCamera = await readCameraState(page);

    const baselinePoint = await readTileCanvasPoint(page, targetTile);
    expect(baselinePoint).not.toBeNull();
    if (baselinePoint === null) {
      throw new Error("Unable to read baseline tile canvas point");
    }

    await minimap.click({ position: { x: 30, y: 30 } });

    await expect
      .poll(async () => readTileCanvasPoint(page, targetTile))
      .not.toBeNull();

    const centeredPoint = await readTileCanvasPoint(page, targetTile);
    if (centeredPoint === null) {
      throw new Error("Unable to read centered tile canvas point");
    }

    const centerX = centeredPoint.canvasWidth / 2;
    const centerY = centeredPoint.canvasHeight / 2;
    const updatedCamera = await readCameraState(page);

    expect(updatedCamera.zoom).toBeCloseTo(initialCamera.zoom, 5);
    expect(updatedCamera.panX).not.toBe(initialCamera.panX);
    expect(updatedCamera.panY).not.toBe(initialCamera.panY);
    expect(Math.abs(centeredPoint.x - centerX)).toBeLessThanOrEqual(2);
    expect(Math.abs(centeredPoint.y - centerY)).toBeLessThanOrEqual(2);
  });

  test("toggles a compact keyboard shortcut overlay", async ({ page }) => {
    await waitForAppReady(page);

    const overlay = page.getByTestId("keyboard-shortcuts-overlay");
    const overlayBackdrop = page.getByTestId("keyboard-shortcuts-overlay-backdrop");
    const overlayToggle = page.getByTestId("control-shortcuts");
    const overlayClose = page.getByTestId("control-shortcuts-close");
    const pauseAction = page.getByTestId("control-shortcuts-action-toggle-pause");
    const stepOneAction = page.getByTestId("control-shortcuts-action-step-1");
    const stepTenAction = page.getByTestId("control-shortcuts-action-step-10");
    const clearToolAction = page.getByTestId("control-shortcuts-action-clear-tool");
    const autoFollowAction = page.getByTestId("control-shortcuts-action-toggle-auto-follow");
    const autoFollowCheckbox = page.getByRole("checkbox", { name: "Auto-follow player camera" });
    const hudPause = page.getByTestId("hud-pause-value");
    const hudTool = page.getByTestId("hud-tool-value");

    await expect(overlay).toHaveCount(0);
    await overlayToggle.click();
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toContainText("Keyboard Shortcuts");
    await expect(overlay).toContainText("Quick actions");
    await expect(overlay).toContainText("Navigation");
    await expect(overlay).toContainText("- / +");
    await expect(overlayClose).toBeVisible();

    await expect(hudPause).toHaveAttribute("data-value", "running");
    await pauseAction.click();
    await expect(hudPause).toHaveAttribute("data-value", "paused");
    const pausedSnapshot = await readSimSnapshot(page);
    await stepOneAction.click();
    const afterOneStep = await readSimSnapshot(page);
    expect(afterOneStep.tickCount).toBe(pausedSnapshot.tickCount + 1);
    await stepTenAction.click();
    const afterTenStep = await readSimSnapshot(page);
    expect(afterTenStep.tickCount).toBe(afterOneStep.tickCount + 10);
    await pauseAction.click();
    await expect(hudPause).toHaveAttribute("data-value", "running");

    await page.keyboard.press("Digit2");
    await expect(hudTool).toHaveText("Belt");
    await clearToolAction.click();
    await expect(hudTool).toHaveText("None");
    await expect(autoFollowCheckbox).not.toBeChecked();
    await autoFollowAction.click();
    await expect(autoFollowCheckbox).toBeChecked();
    await autoFollowAction.click();
    await expect(autoFollowCheckbox).not.toBeChecked();

    await page.keyboard.press("Escape");
    await expect(overlay).toHaveCount(0);
    await overlayToggle.click();
    await expect(overlay).toHaveCount(1);
    await overlayBackdrop.click({ position: { x: 5, y: 5 } });
    await expect(overlay).toHaveCount(0);
    await overlayToggle.click();
    await expect(overlay).toHaveCount(1);
    await overlayClose.click();
    await expect(overlay).toHaveCount(0);
    await page.keyboard.press("KeyK");
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toContainText("1-8");
    await page.keyboard.press("KeyK");
    await expect(overlay).toHaveCount(0);
  });

  test("left click interacts with nearby elements and collisions block player movement", async ({ page }) => {
    await waitForAppReady(page);

    const canvas = worldCanvas(page);
    const status = page.getByRole("status");
    const hudInteractive = page.getByTestId("hud-adjacent-interactive-value");
    const startEntityCount = await readEntityCount(page);

    const player = await readPlayerPosition(page);
    const candidates = [
      { x: player.x + 1, y: player.y, key: "ArrowRight" },
      { x: player.x - 1, y: player.y, key: "ArrowLeft" },
      { x: player.x, y: player.y + 1, key: "ArrowDown" },
      { x: player.x, y: player.y - 1, key: "ArrowUp" },
    ];

    const canPlaceAt = async (kind: EntityKind, x: number, y: number): Promise<boolean> =>
      page.evaluate(
        ({ kind, x, y }) => {
          const sim = (window as { __SIM__?: unknown }).__SIM__;
          if (!sim || typeof sim !== "object" || typeof (sim as { canPlace?: unknown }).canPlace !== "function") {
            return false;
          }

          return (sim as { canPlace: (entityKind: EntityKind, tile: { x: number; y: number }, rotation: number) => boolean })
            .canPlace(kind, { x, y }, 1);
        },
        { kind, x, y },
      );

    type AdjacentCandidate = { x: number; y: number; key: string };
    const obstacleCandidates: AdjacentCandidate[] = [];
    const interactiveCandidates: AdjacentCandidate[] = [];

    for (const candidate of candidates) {
      if (await canPlaceAt("Belt", candidate.x, candidate.y)) {
        obstacleCandidates.push(candidate);
      }
      if (await canPlaceAt("Chest", candidate.x, candidate.y)) {
        interactiveCandidates.push(candidate);
      }
    }

    const obstacle = obstacleCandidates[0];
    const interactive = interactiveCandidates.find(
      (candidate) => obstacle === undefined || candidate.x !== obstacle.x || candidate.y !== obstacle.y,
    );

    if (obstacle === undefined || interactive === undefined) {
      throw new Error("No adjacent placable tiles found for interaction and collision test");
    }

    await expect(hudInteractive).toHaveAttribute("data-value", "none");

    await page.keyboard.press("Digit2");
    await expectActiveSelection(page, "Belt");
    const obstaclePoint = await tileToCanvasPoint(page, obstacle.x, obstacle.y);
    await canvas.click({ position: obstaclePoint, force: true });
    await waitForEntityCount(page, startEntityCount + 1);
    const blockedMoveBefore = await readPlayerPosition(page);
    await page.keyboard.press(obstacle.key);
    await page.waitForTimeout(60);
    const blockedMoveAfter = await readPlayerPosition(page);
    expect(blockedMoveAfter).toEqual(blockedMoveBefore);
    await expect(status).toContainText("Movement blocked: tile occupied by");

    await page.keyboard.press("Digit6");
    await expectActiveSelection(page, "Chest");
    const interactivePoint = await tileToCanvasPoint(page, interactive.x, interactive.y);
    await canvas.click({ position: interactivePoint, force: true });
    await waitForEntityCount(page, startEntityCount + 2);
    await expect(hudInteractive).toHaveAttribute("data-value", /Chest@\(/);

    await page.keyboard.press("Escape");
    await expect(status).toContainText("Tool cleared.");
    await canvas.click({ position: interactivePoint, force: true });
    await expect(status).toContainText("Target has no ready items.");

    await page.keyboard.press("Digit2");
    await expectActiveSelection(page, "Belt");
    await canvas.click({ position: interactivePoint });
    await expect(status).toContainText("Target has no ready items.");
    expect(await readEntityCount(page)).toBe(startEntityCount + 2);

    await page.keyboard.press("Escape");
    await expect(status).toContainText("Tool cleared.");
    await canvas.click({ position: obstaclePoint, force: true });
    await expect(status).toContainText("No active tool.");
  });

  test("left click interacts with nearby non-chest item hosts", async ({ page }) => {
    await waitForAppReady(page);

    const canvas = worldCanvas(page);
    const status = page.getByRole("status");
    const hudInteractive = page.getByTestId("hud-adjacent-interactive-value");
    const startEntityCount = await readEntityCount(page);

    const player = await readPlayerPosition(page);
    const candidates = [
      { x: player.x + 1, y: player.y },
      { x: player.x - 1, y: player.y },
      { x: player.x, y: player.y + 1 },
      { x: player.x, y: player.y - 1 },
    ];

    const canPlaceAt = async (kind: EntityKind, x: number, y: number): Promise<boolean> =>
      page.evaluate(
        ({ kind, x, y }) => {
          const sim = (window as { __SIM__?: unknown }).__SIM__;
          if (!sim || typeof sim !== "object" || typeof (sim as { canPlace?: unknown }).canPlace !== "function") {
            return false;
          }

          return (sim as { canPlace: (entityKind: EntityKind, tile: { x: number; y: number }, rotation: number) => boolean })
            .canPlace(kind, { x, y }, 1);
        },
        { kind, x, y },
      );

    type AdjacentCandidate = { x: number; y: number };
    let interactive: AdjacentCandidate | undefined;
    for (const candidate of candidates) {
      if (await canPlaceAt("Assembler", candidate.x, candidate.y)) {
        interactive = candidate;
        break;
      }
    }

    if (interactive === undefined) {
      throw new Error("No adjacent placeable tile found for assembler interaction test");
    }

    await expect(hudInteractive).toHaveAttribute("data-value", "none");
    await page.keyboard.press("Digit7");
    await expectActiveSelection(page, "Assembler");
    const interactivePoint = await tileToCanvasPoint(page, interactive.x, interactive.y);
    await canvas.click({ position: interactivePoint, force: true });
    await waitForEntityCount(page, startEntityCount + 1);
    await expect(hudInteractive).toHaveAttribute("data-value", /Assembler@\(/);
    await canvas.click({ position: interactivePoint, force: true });
    await expect(status).toContainText("Target has no ready items.");
    expect(await readEntityCount(page)).toBe(startEntityCount + 1);

    await page.keyboard.press("Escape");
    await expect(status).toContainText("Tool cleared.");
    await canvas.click({ position: interactivePoint, force: true });
    await expect(status).toContainText("Target has no ready items.");
  });

  test("adjacent interactive diagnostics are shown in HUD", async ({ page }) => {
    await waitForAppReady(page);

    const canvas = worldCanvas(page);
    const hudInteractive = page.getByTestId("hud-adjacent-interactive-value");
    const hudInteractiveDetails = page.getByTestId("hud-adjacent-interactive-details");
    const hudPauseValue = page.getByTestId("hud-pause-value");
    const startEntityCount = await readEntityCount(page);

    const target = await movePlayerToAdjacentMineableTile(page);
    if (target.found !== true) {
      throw new Error(`Unable to locate mineable tile for diagnostics test: ${target.reason}`);
    }

    await expect(hudInteractive).toHaveAttribute("data-value", "none");
    await expect(hudInteractiveDetails).toHaveText("none");

    await page.getByRole("button", { name: "Miner" }).click();
    await expectActiveSelection(page, "Miner");
    const minerPoint = await tileToCanvasPoint(page, target.mineableTileX, target.mineableTileY);
    await canvas.click({ position: minerPoint, force: true });
    await waitForEntityCount(page, startEntityCount + 1);

    await expect(hudInteractive).toHaveAttribute("data-value", /Miner@\(/);
    await expect(hudInteractiveDetails).toContainText(/output|hasOutput|justMined/);

    await expect(hudPauseValue).toHaveAttribute("data-value", "running");
    await page.keyboard.press("Space");
    await expect(hudPauseValue).toHaveAttribute("data-value", "paused");
    await expect(hudInteractiveDetails).not.toHaveText("none");
    await page.keyboard.press("Space");
    await expect(hudPauseValue).toHaveAttribute("data-value", "running");

    await page.keyboard.press("Escape");
    await expect(hudInteractive).toHaveAttribute("data-value", /Miner@\(/);
    await expect(hudInteractiveDetails).not.toHaveText("none");
  });

  test("clicking entities updates the selected entity HUD snapshot", async ({ page }) => {
    await waitForAppReady(page);

    const canvas = worldCanvas(page);
    const status = page.getByRole("status");
    const selectedValue = page.getByTestId("hud-selected-entity-value");
    const selectedDetails = page.getByTestId("hud-selected-entity-details");
    const startEntityCount = await readEntityCount(page);
    const player = await readPlayerPosition(page);

    const candidates = [
      { x: player.x + 1, y: player.y },
      { x: player.x - 1, y: player.y },
      { x: player.x, y: player.y + 1 },
      { x: player.x, y: player.y - 1 },
    ];

    const canPlaceAt = async (kind: EntityKind, x: number, y: number): Promise<boolean> =>
      page.evaluate(
        ({ kind, x, y }) => {
          const sim = (window as { __SIM__?: unknown }).__SIM__;
          if (!sim || typeof sim !== "object" || typeof (sim as { canPlace?: unknown }).canPlace !== "function") {
            return false;
          }

          return (sim as { canPlace: (entityKind: EntityKind, tile: { x: number; y: number }, rotation: number) => boolean })
            .canPlace(kind, { x, y }, 1);
        },
        { kind, x, y },
      );

    type AdjacentCandidate = { x: number; y: number };
    let chestCandidate: AdjacentCandidate | undefined;
    for (const candidate of candidates) {
      if (await canPlaceAt("Chest", candidate.x, candidate.y)) {
        chestCandidate = candidate;
        break;
      }
    }

    if (chestCandidate === undefined) {
      throw new Error("No adjacent placeable tile found for selected-entity HUD test");
    }

    await expect(selectedValue).toHaveAttribute("data-value", "none");
    await expect(selectedDetails).toHaveText("none");

    await page.getByRole("button", { name: "Chest" }).click();
    await expectActiveSelection(page, "Chest");
    const chestPoint = await tileToCanvasPoint(page, chestCandidate.x, chestCandidate.y);
    await canvas.click({ position: chestPoint, force: true });
    await waitForEntityCount(page, startEntityCount + 1);

    await page.keyboard.press("Escape");
    await expect(status).toContainText("Tool cleared.");
    await canvas.click({ position: chestPoint, force: true });
    await expect(selectedValue).toHaveAttribute("data-value", /Chest@\(/);
    await expect(selectedDetails).not.toHaveText("none");
    await expect(status).toContainText("Target has no ready items.");
  });

  test("tutorial missions progress in order and stay robust", async ({ page }) => {
    await waitForAppReady(page);

    const canvas = worldCanvas(page);

    await enableTutorialMode(page);
    await expectNextTutorialMissionToContain(page, "Move the player");

    await page.keyboard.press("Digit0");
    await page.keyboard.press("Digit1");
    await expectNextTutorialMissionToContain(page, "Move the player");

    const moved = await movePlayerOneStep(page);
    if (moved !== true) {
      throw new Error("Unable to move player at start of tutorial mission regression test");
    }
    await expectNextTutorialMissionToContain(page, "Choose a build tool");

    await page.keyboard.press("Digit1");
    await expectNextTutorialMissionToContain(page, "Place your first Miner");

    const beforePlacingMiner = await readEntityCount(page);
    const minerTile = await findPlaceableTile(page, "Miner", 0);
    const minerPoint = await tileToCanvasPoint(page, minerTile.tileX, minerTile.tileY);
    if (minerPoint === null) {
      throw new Error("Unable to compute miner tile point");
    }
    await canvas.click({ position: minerPoint, force: true });
    await waitForEntityCount(page, beforePlacingMiner + 1);
    await expectNextTutorialMissionToContain(page, "Lay a Belt");

    await page.keyboard.press("Digit2");
    const beforePlacingBelt = await readEntityCount(page);
    const beltTile = await findPlaceableTile(page, "Belt", 0);
    const beltPoint = await tileToCanvasPoint(page, beltTile.tileX, beltTile.tileY);
    if (beltPoint === null) {
      throw new Error("Unable to compute belt tile point");
    }
    await canvas.click({ position: beltPoint, force: true });
    await waitForEntityCount(page, beforePlacingBelt + 1);
    await expectNextTutorialMissionToContain(page, "Place a Chest");

    await page.keyboard.press("Digit6");
    const beforePlacingChest = await readEntityCount(page);
    const chestTile = await findPlaceableTile(page, "Chest", 0);
    const chestPoint = await tileToCanvasPoint(page, chestTile.tileX, chestTile.tileY);
    if (chestPoint === null) {
      throw new Error("Unable to compute chest tile point");
    }
    await canvas.click({ position: chestPoint, force: true });
    await waitForEntityCount(page, beforePlacingChest + 1);
    await expectNextTutorialMissionToContain(page, "Mine a Resource");

    await page.keyboard.press("Escape");
    const mineableTile = await movePlayerToAdjacentMineableTile(page);
    const beforeInventory = await readRuntimeInventory(page);
    const beforeRemaining = await readRuntimeResourceRemaining(page, {
      x: mineableTile.mineableTileX,
      y: mineableTile.mineableTileY,
    });
    const minePoint = await tileToCanvasPoint(page, mineableTile.mineableTileX, mineableTile.mineableTileY);
    if (minePoint === null) {
      throw new Error("Unable to compute mine tile point");
    }
    await canvas.click({ position: minePoint, force: true });
    await expect
      .poll(async () => {
        const inventory = await readRuntimeInventory(page);
        return inventory[mineableTile.resourceType as keyof Omit<RuntimeItemInventory, "used" | "capacity">];
      })
      .toBeGreaterThan(beforeInventory[mineableTile.resourceType as keyof Omit<RuntimeItemInventory, "used" | "capacity">]);
    await expect
      .poll(async () => readRuntimeResourceRemaining(page, {
        x: mineableTile.mineableTileX,
        y: mineableTile.mineableTileY,
      }))
      .toBeLessThan(beforeRemaining);
    await expectNextTutorialMissionToContain(page, "Move items with interactions");

    const playerPosition = await readPlayerPosition(page);
    const canPlaceAt = async (kind: EntityKind, x: number, y: number): Promise<boolean> =>
      page.evaluate(
        ({ kind, x, y }) => {
          const sim = (window as { __SIM__?: unknown }).__SIM__;
          if (!sim || typeof sim !== "object" || typeof (sim as { canPlace?: unknown }).canPlace !== "function") {
            return false;
          }

          return (sim as { canPlace: (entityKind: EntityKind, tile: { x: number; y: number }, rotation: number) => boolean })
            .canPlace(kind, { x, y }, 1);
        },
        { kind, x, y },
      );

    const interactionCandidates = [
      { x: playerPosition.x + 1, y: playerPosition.y },
      { x: playerPosition.x - 1, y: playerPosition.y },
      { x: playerPosition.x, y: playerPosition.y + 1 },
      { x: playerPosition.x, y: playerPosition.y - 1 },
    ];

    let interactionTile: { x: number; y: number } | null = null;
    for (const candidate of interactionCandidates) {
      if (await canPlaceAt("Chest", candidate.x, candidate.y)) {
        interactionTile = candidate;
        break;
      }
    }

    if (interactionTile === null) {
      throw new Error("Unable to place a chest next to the player for transfer-items tutorial step");
    }

    const beforeTransferChest = await readEntityCount(page);
    await placeEntityAt(page, "Chest", interactionTile.x, interactionTile.y);
    await waitForEntityCount(page, beforeTransferChest + 1);
    const interactionPoint = await tileToCanvasPoint(page, interactionTile.x, interactionTile.y);
    if (interactionPoint === null) {
      throw new Error("Unable to compute transfer-items chest point");
    }
    await page.keyboard.press("Escape");
    await canvas.click({ position: interactionPoint, force: true });
    const beforeTransferInventory = await readRuntimeInventory(page);
    expect(beforeTransferInventory.used).toBeGreaterThan(0);

    await page.waitForTimeout(120);
    const afterTransferClickInventory = await readRuntimeInventory(page);
    if (afterTransferClickInventory.used >= beforeTransferInventory.used) {
      await page.keyboard.press("KeyE");
      await expect
        .poll(async () => {
          const afterTransferInventory = await readRuntimeInventory(page);
          return afterTransferInventory.used;
        })
        .toBeLessThan(beforeTransferInventory.used);
    }

    await expectNextTutorialMissionToContain(page, "Build a power source");

    await page.keyboard.press("Digit8");
    const beforePlacingSolarPanel = await readEntityCount(page);
    const solarPanelTile = await findPlaceableTile(page, "SolarPanel", 0);
    const solarPanelPoint = await tileToCanvasPoint(page, solarPanelTile.tileX, solarPanelTile.tileY);
    if (solarPanelPoint === null) {
      throw new Error("Unable to compute solar panel tile point");
    }
    await canvas.click({ position: solarPanelPoint, force: true });
    await waitForEntityCount(page, beforePlacingSolarPanel + 1);
    await expectNextTutorialMissionToContain(page, "Build a power source");

    await expectNextTutorialMissionToContain(page, "Sustain the power grid");
  });

  test("left click on mineable tile mines one resource unit per click", async ({ page }) => {
    await waitForAppReady(page);

    const canvas = worldCanvas(page);
    const status = page.getByRole("status");
    await page.keyboard.press("Escape");

    const target = await movePlayerToAdjacentMineableTile(page);
    await page.keyboard.press("Home");
    const point = await tileToCanvasPoint(page, target.mineableTileX, target.mineableTileY);

    const beforeInventory = await readRuntimeInventory(page);
    const clicks = Math.max(1, Math.min(2, target.beforeRemaining - 1));

    for (let i = 0; i < clicks; i += 1) {
      await canvas.click({ position: point, force: true });
    }
    await expect(status).toContainText("Mined");
    const expectedRemaining = target.beforeRemaining - clicks;
    await expect(status).toContainText(`remaining ${expectedRemaining}`);

    const expectedField = target.resourceType;
    const expectedAfter = beforeInventory[expectedField] + clicks;
    await expect
      .poll(async () => {
        const current = await readRuntimeInventory(page);
        return current[expectedField];
      })
      .toBe(expectedAfter);

    const afterInventory = await readRuntimeInventory(page);
    expect(afterInventory[expectedField]).toBe(expectedAfter);
    expect(afterInventory.used).toBe(beforeInventory.used + clicks);

    const afterRemaining = await readRuntimeResourceRemaining(page, {
      x: target.mineableTileX,
      y: target.mineableTileY,
    });
    expect(afterRemaining).toBe(target.beforeRemaining - clicks);
    expect(afterRemaining).toBeGreaterThanOrEqual(0);
    if (target.beforeRemaining - clicks > 0) {
      expect(afterRemaining).toBeGreaterThan(0);
    }
  });

  test("player cannot move onto mineable tiles", async ({ page }) => {
    await waitForAppReady(page);

    const positionBeforeMineable = await movePlayerToAdjacentMineableTile(page);
    const playerBefore = await readPlayerPosition(page);

    const dx = positionBeforeMineable.mineableTileX - playerBefore.x;
    const dy = positionBeforeMineable.mineableTileY - playerBefore.y;
    let key: string | null = null;

    if (dx === 1 && dy === 0) {
      key = "ArrowRight";
    } else if (dx === -1 && dy === 0) {
      key = "ArrowLeft";
    } else if (dx === 0 && dy === 1) {
      key = "ArrowDown";
    } else if (dx === 0 && dy === -1) {
      key = "ArrowUp";
    } else {
      throw new Error("Mineable tile is not adjacent after helper move.");
    }

    const status = page.getByRole("status");
    await page.keyboard.press(key);
    const playerAfter = await readPlayerPosition(page);
    expect(playerAfter.x).toBe(playerBefore.x);
    expect(playerAfter.y).toBe(playerBefore.y);
    await expect(status).toContainText("Movement blocked");
  });

  test("has no runtime render errors during first interaction", async ({ page }) => {
    const { pageErrors, consoleErrors } = attachRuntimeErrorCollectors(page);
    await waitForAppReady(page);

    await page.waitForTimeout(300);
    const canvas = worldCanvas(page);
    await page.keyboard.press("Digit2");
    await page.keyboard.press("KeyR");
    const tile = await findPlaceableTile(page, "Belt", 1);
    await canvas.click({ position: { x: tile.x, y: tile.y } });
    await waitForEntityCount(page, 1);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test("validates select/rotate/place/remove/pause/resume flow", async ({ page }) => {
    await waitForAppReady(page);

    const miner = page.getByRole("button", { name: "Miner" });
    const belt = page.getByRole("button", { name: "Belt" });
    const splitter = page.getByRole("button", { name: "Splitter" });
    const inserter = page.getByRole("button", { name: "Inserter" });
    const furnace = page.getByRole("button", { name: "Furnace" });
    const chest = page.getByRole("button", { name: "Chest" });
    const assembler = page.getByRole("button", { name: "Assembler" });
    const solarPanel = page.getByRole("button", { name: "SolarPanel" });

    await expectActiveSelection(page, "Miner");
    await page.keyboard.press("Digit1");
    await expectActiveSelection(page, "Miner");
    await page.keyboard.press("Digit2");
    await expectActiveSelection(page, "Belt");
    await page.keyboard.press("Digit3");
    await expectActiveSelection(page, "Splitter");
    await page.keyboard.press("Digit4");
    await expectActiveSelection(page, "Inserter");
    await page.keyboard.press("Digit5");
    await expectActiveSelection(page, "Furnace");
    await page.keyboard.press("Digit6");
    await expectActiveSelection(page, "Chest");
    await page.keyboard.press("Digit7");
    await expectActiveSelection(page, "Assembler");
    await page.keyboard.press("Digit8");
    await expectActiveSelection(page, "SolarPanel");
    await page.keyboard.press("Digit2");
    await expectActiveSelection(page, "Belt");

    await page.keyboard.press("KeyR");
    await page.waitForFunction(() => {
      const sim = (window as { __SIM__?: { tick?: number } }).__SIM__;
      return sim && typeof sim.tick === "number" && sim.tick > 0;
    });

    const canvas = worldCanvas(page);
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
    const prePauseTick = (await readSimSnapshot(page)).tickCount;
    await page.keyboard.press("Space");
    const pausedSamples = await sampleTickSamples(page, 4, 80);
    expectSamplesNoProgress(pausedSamples);
    const frozenTick = pausedSamples[pausedSamples.length - 1]?.tickCount;
    if (frozenTick === undefined) {
      throw new Error("Unable to sample paused tick count");
    }

    expect(frozenTick).toBeLessThanOrEqual(prePauseTick + 1);
    await page.keyboard.press("Space");
    const resumedSamples = await sampleTickSamples(page, 6, 50);
    const resumedTick = resumedSamples[resumedSamples.length - 1]?.tickCount;
    if (resumedTick === undefined) {
      throw new Error("Unable to sample resumed tick count");
    }

    expectTickCadence(resumedSamples);
    expect(resumedTick).toBeGreaterThan(frozenTick);

    await expect(miner).toHaveAttribute("aria-pressed", "false");
    await expect(belt).toHaveAttribute("aria-pressed", "true");
    await expect(splitter).toHaveAttribute("aria-pressed", "false");
    await expect(inserter).toHaveAttribute("aria-pressed", "false");
    await expect(furnace).toHaveAttribute("aria-pressed", "false");
    await expect(chest).toHaveAttribute("aria-pressed", "false");
    await expect(assembler).toHaveAttribute("aria-pressed", "false");
    await expect(solarPanel).toHaveAttribute("aria-pressed", "false");
  });

  test("validates long transport cadence and pause/resume stability", async ({ page }) => {
    await waitForAppReady(page);

    await rotateToDirection(page, "E");
    const layout = await findTransportLayout(page);

    const baseline = await readSimSnapshot(page);
    await placeEntityAt(page, "Miner", layout.miner.tileX, layout.miner.tileY);
    await placeEntityAt(page, "Belt", layout.beltOne.tileX, layout.beltOne.tileY);
    await placeEntityAt(page, "Belt", layout.beltTwo.tileX, layout.beltTwo.tileY);
    await placeEntityAt(page, "Inserter", layout.inserter.tileX, layout.inserter.tileY);
    await placeEntityAt(page, "Furnace", layout.furnace.tileX, layout.furnace.tileY);
    await waitForEntityCount(page, baseline.entityCount + 5);

    const runningSamples = await sampleTickSamples(page, TRANSPORT_SAMPLE_COUNT, TRANSPORT_SAMPLE_DELAY_MS);
    expectSteadyCadence(runningSamples, TRANSPORT_CADENCE_TICKS, TRANSPORT_MIN_WINDOWS);

    await page.keyboard.press("Space");
    const pausedSamples = await sampleTickSamples(page, 12, 80);
    expectSamplesNoProgress(pausedSamples);

    await page.keyboard.press("Space");
    const resumedSamples = await sampleTickSamples(page, TRANSPORT_SAMPLE_COUNT, TRANSPORT_SAMPLE_DELAY_MS);
    expectSteadyCadence(resumedSamples, TRANSPORT_CADENCE_TICKS, TRANSPORT_MIN_WINDOWS);
    expectNoResumeJump(pausedSamples, resumedSamples, 1);
  });

  test("keeps fixed-step pause/resume boundaries stable during placement path", async ({ page }) => {
    await waitForAppReady(page);

    const canvas = worldCanvas(page);
    const baseline = await readSimSnapshot(page);
    await expectActiveSelection(page, "Miner");
    await page.keyboard.press("Digit2");
    await expectActiveSelection(page, "Belt");
    await rotateToDirection(page, "N");

    const tile = await findPlaceableTile(page, "Belt", 0);
    await canvas.click({ position: { x: tile.x, y: tile.y } });
    await waitForEntityCount(page, baseline.entityCount + 1);

    const placedSnapshot = await readSimSnapshot(page);
    const placedEntity = placedSnapshot.entities.find((entity) => entity.pos.x === tile.tileX && entity.pos.y === tile.tileY);
    expect(placedEntity?.kind).toBe("Belt");

    await expectTickCountToIncrease(page, placedSnapshot.tickCount);

    await page.keyboard.press("Space");
    const pausedSamples = await sampleTickSamples(page, 8, 50);
    expectSamplesNoProgress(pausedSamples);

    await page.keyboard.press("Space");
    const resumedSamples = await sampleTickSamples(page, 8, 50);
    expectResumeFromPausedBoundary(pausedSamples, resumedSamples, 1);
    expectTickCadence(resumedSamples);

    await canvas.click({ position: { x: tile.x, y: tile.y }, button: "right" });
    await waitForEntityCount(page, baseline.entityCount);
    const removedSnapshot = await readSimSnapshot(page);
    expect(
      removedSnapshot.entities.some((entity) => entity.pos.x === tile.tileX && entity.pos.y === tile.tileY),
    ).toBe(false);

    await canvas.click({ position: { x: tile.x, y: tile.y } });
    await waitForEntityCount(page, baseline.entityCount + 1);
    const replacedSnapshot = await readSimSnapshot(page);
    const replacedEntity = replacedSnapshot.entities.find((entity) => entity.pos.x === tile.tileX && entity.pos.y === tile.tileY);
    expect(replacedEntity?.kind).toBe("Belt");
  });
});
