/*
  Canvas2D renderer that consumes simulation snapshots and draws:
  - Grid and ore tiles
  - Miners, belts (with direction glyph), inserters (animated arm), furnaces (progress bar)
  - Belt items as small shapes when exposed by snapshot state
  - Placement ghost/hover highlight

  Designed to match App.tsx usage: createRenderer(canvas) -> { setGhost, resize?, destroy }
*/

import { createSnapshot, type Snapshot } from "../core/snapshot";
import type { Direction, EntityKind, ItemKind } from "../core/types";

type Tile = { x: number; y: number };

// Colors
const GRID_COLOR = "#3e4a57";
const ORE_COLOR = "#c47f2d";
const GHOST_OK_FILL = "rgba(139, 233, 253, 0.18)"; // cyan-ish
const GHOST_BAD_FILL = "rgba(255, 99, 99, 0.18)"; // red-ish
const GHOST_STROKE_OK = "#8be9fd";
const GHOST_STROKE_BAD = "#ff6b6b";
const MINER_COLOR = "#66c2a5";
const BELT_COLOR = "#8da0cb";
const INSERTER_BASE = "#e78ac3";
const INSERTER_ARM = "#ffb3de";
const FURNACE_COLOR = "#fc8d62";
const ITEM_ORE = "#b0792a";
const ITEM_PLATE = "#c0c5cf";
const ITEM_GENERIC = "#d4d4d4";

// Direction helpers
const dirToAngleRad = (d: Direction): number => {
  switch (d) {
    case "N":
      return -Math.PI / 2;
    case "E":
      return 0;
    case "S":
      return Math.PI / 2;
    case "W":
      return Math.PI;
    default:
      return 0;
  }
};

type Transform = {
  scale: number;
  offsetX: number;
  offsetY: number;
  tileRender: number; // tileSize * scale
};

function computeTransform(canvas: HTMLCanvasElement, gridWidth: number, gridHeight: number, tileSize: number): Transform {
  const worldW = gridWidth * tileSize;
  const worldH = gridHeight * tileSize;
  const scale = Math.max(0.0001, Math.min(canvas.width / worldW, canvas.height / worldH));
  const viewW = worldW * scale;
  const viewH = worldH * scale;
  const offsetX = Math.floor((canvas.width - viewW) / 2);
  const offsetY = Math.floor((canvas.height - viewH) / 2);
  return { scale, offsetX, offsetY, tileRender: tileSize * scale };
}

function drawGrid(ctx: CanvasRenderingContext2D, gridW: number, gridH: number, tile: number, t: Transform): void {
  ctx.save();
  ctx.translate(t.offsetX, t.offsetY);
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = Math.max(1, Math.floor(t.scale));
  // vertical lines
  for (let x = 0; x <= gridW; x += 1) {
    const px = Math.floor(x * t.tileRender) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, gridH * t.tileRender);
    ctx.stroke();
  }
  // horizontal lines
  for (let y = 0; y <= gridH; y += 1) {
    const py = Math.floor(y * t.tileRender) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(gridW * t.tileRender, py);
    ctx.stroke();
  }
  ctx.restore();
}

function fillTile(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, t: Transform): void {
  ctx.fillStyle = color;
  ctx.fillRect(
    Math.floor(t.offsetX + x * t.tileRender) + 1,
    Math.floor(t.offsetY + y * t.tileRender) + 1,
    Math.ceil(t.tileRender) - 2,
    Math.ceil(t.tileRender) - 2,
  );
}

function drawOre(ctx: CanvasRenderingContext2D, ore: ReadonlyArray<{ x: number; y: number }>, t: Transform): void {
  ctx.save();
  for (const cell of ore) {
    fillTile(ctx, cell.x, cell.y, ORE_COLOR, t);
  }
  ctx.restore();
}

function drawGhost(ctx: CanvasRenderingContext2D, ghost: { tile: Tile | null; valid: boolean }, t: Transform): void {
  if (ghost.tile === null) return;
  const gx = t.offsetX + ghost.tile.x * t.tileRender;
  const gy = t.offsetY + ghost.tile.y * t.tileRender;
  ctx.save();
  ctx.fillStyle = ghost.valid ? GHOST_OK_FILL : GHOST_BAD_FILL;
  ctx.strokeStyle = ghost.valid ? GHOST_STROKE_OK : GHOST_STROKE_BAD;
  ctx.lineWidth = Math.max(1, Math.floor(t.scale * 2));
  ctx.beginPath();
  ctx.rect(Math.floor(gx) + 0.5, Math.floor(gy) + 0.5, Math.ceil(t.tileRender) - 1, Math.ceil(t.tileRender) - 1);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawMiner(ctx: CanvasRenderingContext2D, x: number, y: number, rot: Direction, t: Transform): void {
  const cx = t.offsetX + (x + 0.5) * t.tileRender;
  const cy = t.offsetY + (y + 0.5) * t.tileRender;
  const r = (t.tileRender * 0.8) / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(dirToAngleRad(rot));
  ctx.fillStyle = MINER_COLOR;
  ctx.beginPath();
  ctx.moveTo(-r, -r);
  ctx.lineTo(r, 0);
  ctx.lineTo(-r, r);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBelt(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rot: Direction,
  itemHint: ReadonlyArray<ItemKind | null> | undefined,
  t: Transform,
): void {
  // Base belt body
  const px = t.offsetX + x * t.tileRender;
  const py = t.offsetY + y * t.tileRender;
  const pad = t.tileRender * 0.15;
  ctx.save();
  ctx.fillStyle = BELT_COLOR;
  ctx.fillRect(px + pad, py + pad, t.tileRender - 2 * pad, t.tileRender - 2 * pad);

  // Direction arrow
  const cx = px + t.tileRender / 2;
  const cy = py + t.tileRender / 2;
  ctx.translate(cx, cy);
  ctx.rotate(dirToAngleRad(rot));
  ctx.fillStyle = "#2b2f3a";
  ctx.beginPath();
  ctx.moveTo(-t.tileRender * 0.18, -t.tileRender * 0.12);
  ctx.lineTo(t.tileRender * 0.18, 0);
  ctx.lineTo(-t.tileRender * 0.18, t.tileRender * 0.12);
  ctx.closePath();
  ctx.fill();

  // Items on belt (read from committed snapshot slot list)
  const items = parseBeltItems(itemHint);
  for (const it of items) {
    const color = it.kind === "iron-ore" ? ITEM_ORE : it.kind === "iron-plate" ? ITEM_PLATE : ITEM_GENERIC;
    const ix = -t.tileRender * 0.25 + it.pos * (t.tileRender * 0.5);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ix, 0, Math.max(2, t.tileRender * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawInserter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rot: Direction,
  state: InserterState | undefined,
  t: Transform,
  timeTick: number,
): void {
  const baseX = t.offsetX + (x + 0.5) * t.tileRender;
  const baseY = t.offsetY + (y + 0.5) * t.tileRender;
  ctx.save();
  // base
  ctx.fillStyle = INSERTER_BASE;
  ctx.beginPath();
  ctx.arc(baseX, baseY, Math.max(2, t.tileRender * 0.12), 0, Math.PI * 2);
  ctx.fill();

  // arm rotation: parse from state; fallback to time-based sweep
  const phase = parseInserterPhase(state, timeTick);
  const angle = dirToAngleRad(rot) + (phase - 0.5) * Math.PI * 0.75; // +/- 67.5deg around facing
  const armLen = t.tileRender * 0.42;

  ctx.strokeStyle = INSERTER_ARM;
  ctx.lineWidth = Math.max(2, t.tileRender * 0.08);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(baseX, baseY);
  ctx.lineTo(baseX + Math.cos(angle) * armLen, baseY + Math.sin(angle) * armLen);
  ctx.stroke();
  ctx.restore();
}

function drawFurnace(ctx: CanvasRenderingContext2D, x: number, y: number, progress: number | null, t: Transform): void {
  const px = t.offsetX + x * t.tileRender;
  const py = t.offsetY + y * t.tileRender;
  ctx.save();
  // body
  ctx.fillStyle = FURNACE_COLOR;
  ctx.fillRect(px + 2, py + 2, Math.ceil(t.tileRender) - 4, Math.ceil(t.tileRender) - 4);

  // progress bar (bottom)
  const frac = progress !== null ? clamp01(progress) : 0;
  const barW = (Math.ceil(t.tileRender) - 6) * frac;
  const barH = Math.max(3, Math.floor(t.tileRender * 0.12));
  ctx.fillStyle = frac > 0 ? "#ffe082" : "#444";
  ctx.fillRect(px + 3, py + Math.ceil(t.tileRender) - barH - 3, barW, barH);
  ctx.restore();
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

type InserterState = "idle" | "pickup" | "swing" | "drop";

type BeltItem = {
  kind: ItemKind;
  pos: number;
};

function parseBeltItems(items: ReadonlyArray<ItemKind | null> | undefined): BeltItem[] {
  if (items === undefined) {
    return [];
  }

  const result: BeltItem[] = [];
  const denom = Math.max(1, items.length);

  for (let index = 0; index < items.length; index += 1) {
    const itemKind = items[index];
    if (itemKind !== "iron-ore" && itemKind !== "iron-plate") {
      continue;
    }

    result.push({
      kind: itemKind,
      pos: clamp01((index + 0.5) / denom),
    });
  }

  return result;
}

function parseInserterPhase(state: InserterState | undefined, tick: number): number {
  const base = state === "pickup" ? 0.2 : state === "swing" ? 0.5 : state === "drop" ? 0.8 : 0.15;
  const sweep = ((tick % 20) / 20 - 0.5) * 0.12;
  return clamp01(base + sweep);
}

function parseFurnaceProgress(progress01: number | undefined): number | null {
  if (typeof progress01 === "number") {
    return clamp01(progress01);
  }
  return null;
}

type RendererApi = {
  setGhost(tile: Tile | null, valid: boolean): void;
  resize?(width: number, height: number): void;
  destroy(): void;
};

declare global {
  interface Window {
    __SIM__?: unknown;
  }
}

export function createRenderer(canvas: HTMLCanvasElement): RendererApi {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable");
  }

  let ghost: { tile: Tile | null; valid: boolean } = { tile: null, valid: false };
  let rafId: number | null = null;
  let destroyed = false;

  const readSnapshot = (): Snapshot | null => {
    const sim = window.__SIM__;
    if (typeof sim !== "object" || sim === null) {
      return null;
    }

    try {
      return createSnapshot(sim);
    } catch {
      return null;
    }
  };

  const draw = (): void => {
    if (destroyed) return;

    const snapshot = readSnapshot();
    if (snapshot === null) {
      // If snapshot fails (e.g., no sim present yet), clear and request next frame
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      scheduleNext();
      return;
    }

    // Canvas clearing
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const gridW = snapshot.grid.width;
    const gridH = snapshot.grid.height;
    const tile = snapshot.grid.tileSize;
    if (gridW <= 0 || gridH <= 0) {
      scheduleNext();
      return;
    }

    const t = computeTransform(canvas, gridW, gridH, tile);

    // Layers
    drawGrid(ctx, gridW, gridH, tile, t);
    drawOre(ctx, snapshot.ore, t);

    // Entities
    for (const e of snapshot.entities) {
      switch (e.kind as EntityKind) {
        case "miner":
          drawMiner(ctx, e.pos.x, e.pos.y, e.rot, t);
          break;
        case "belt":
          drawBelt(ctx, e.pos.x, e.pos.y, e.rot, e.items, t);
          break;
        case "inserter":
          drawInserter(ctx, e.pos.x, e.pos.y, e.rot, e.state, t, snapshot.time.tick);
          break;
        case "furnace": {
          const progress = parseFurnaceProgress(e.progress01);
          drawFurnace(ctx, e.pos.x, e.pos.y, progress, t);
          break;
        }
        default:
          // resource/chest/unknown: skip
          break;
      }
    }

    // Ghost highlight on top
    drawGhost(ctx, ghost, t);

    scheduleNext();
  };

  const scheduleNext = (): void => {
    if (destroyed) return;
    rafId = window.requestAnimationFrame(draw);
  };

  // Kick off loop
  scheduleNext();

  return {
    setGhost(tile: Tile | null, valid: boolean): void {
      ghost = { tile, valid };
    },
    resize(): void {
      // Nothing to do here; draw() reads canvas size each frame.
    },
    destroy(): void {
      destroyed = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };
}
