/*
  Canvas2D renderer that consumes simulation snapshots and draws:
  - Grid and ore tiles
  - Miners, belts (with direction glyph), inserters (animated arm), furnaces (progress bar)
  - Belt items as small shapes when exposed by snapshot state
  - Placement ghost/hover highlight

  Designed to match App.tsx usage: createRenderer(canvas) -> { setGhost, resize?, destroy }
*/

import { createSnapshot, type Snapshot } from "../core/snapshot";
import { rotateDirection } from "../core/types";
import type { Direction, EntityKind, ItemKind } from "../core/types";

declare global {
  interface Window {
    __SIM__?: unknown;
    __USE_SVGS__?: boolean;
  }
}

const imageCache: Record<string, HTMLImageElement> = {};
const SVG_ASSET_NAMES = [
  "miner",
  "transport-belt-basic-yellow",
  "basic-inserter",
  "furnace",
  "solar-panel",
  "chest",
  "iron-ore",
  "coal",
  "player",
  "tree",
] as const;

const SVG_ROTATION_OFFSETS_RAD: Readonly<Record<string, number>> = {
  // Authored assets are north-up at 0deg; runtime uses east-facing at 0deg.
  miner: Math.PI / 2,
  belt: Math.PI / 2,
  "transport-belt-basic-yellow": Math.PI / 2,
  "transport-belt-fast-red": Math.PI / 2,
  "transport-belt-express-blue": Math.PI / 2,
  inserter: Math.PI / 2,
  "basic-inserter": Math.PI / 2,
  "burner-inserter": Math.PI / 2,
  "fast-inserter": Math.PI / 2,
  player: 0,
};

function getSvg(name: string): HTMLImageElement | null {
  if (imageCache[name]) return imageCache[name];

  const img = new Image();
  img.src = `/${name}.svg`;
  imageCache[name] = img;
  return img;
}

export function preloadRendererSvgs(): void {
  for (const name of SVG_ASSET_NAMES) {
    getSvg(name);
  }
}

function drawSvg(
  ctx: CanvasRenderingContext2D,
  name: string,
  x: number,
  y: number,
  rot: Direction,
  t: Transform,
  fitScale = 1.0,
  yOffsetPx = 0,
): boolean {
  const img = getSvg(name);
  if (!img || !img.complete || img.naturalWidth === 0) return false;

  const size = t.tileRender * fitScale;
  const cx = t.offsetX + (x + 0.5) * t.tileRender;
  const cy = t.offsetY + (y + 0.5) * t.tileRender;

  ctx.save();
  ctx.translate(cx, cy + yOffsetPx);
  const rotationOffset = SVG_ROTATION_OFFSETS_RAD[name] ?? 0;
  ctx.rotate(dirToAngleRad(rot) + rotationOffset);
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
  return true;
}

type Tile = { x: number; y: number };

// Colors
const GRID_COLOR = "#3e4a57";
const ORE_COLOR = "#c47f2d";
const COAL_COLOR = "#2f2f2f";
const WOOD_COLOR = "#4d6b37";
const GHOST_OK_FILL = "rgba(139, 233, 253, 0.18)"; // cyan-ish
const GHOST_BAD_FILL = "rgba(255, 99, 99, 0.18)"; // red-ish
const GHOST_STROKE_OK = "#8be9fd";
const GHOST_STROKE_BAD = "#ff6b6b";
const MINER_COLOR = "#66c2a5";
const BELT_COLOR = "#8da0cb";
const SPLITTER_COLOR = "#6dd3f7";
const INSERTER_BASE = "#e78ac3";
const INSERTER_ARM = "#ffb3de";
const FURNACE_COLOR = "#fc8d62";
const ASSEMBLER_COLOR = "#8f78ff";
const ACCUMULATOR_COLOR = "#f8d568";
const ITEM_ORE = "#b0792a";
const ITEM_PLATE = "#c0c5cf";
const ITEM_COAL = "#2f2f2f";
const ITEM_WOOD = WOOD_COLOR;
const ITEM_GEAR = "#c084fc";
const ITEM_GENERIC = "#d4d4d4";
const CONVEYOR_HINT_LOW = "#22c55e";
const CONVEYOR_HINT_MID = "#facc15";
const CONVEYOR_HINT_HIGH = "#ef4444";

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

type CameraTransform = {
  zoom: number;
  panX: number;
  panY: number;
};

type SnapshotWithOptionalPlayer = Snapshot & {
  player?: {
    x: number;
    y: number;
    rot?: Direction;
    fuel?: number;
    maxFuel?: number;
  };
};

function computeTransform(
  canvas: HTMLCanvasElement,
  gridWidth: number,
  gridHeight: number,
  tileSize: number,
  camera?: CameraTransform,
): Transform {
  const worldW = gridWidth * tileSize;
  const worldH = gridHeight * tileSize;
  const baseScale = Math.max(0.0001, Math.min(canvas.width / worldW, canvas.height / worldH));
  const zoom = typeof camera?.zoom === 'number' ? Math.max(0.05, camera.zoom) : 1;
  const scale = baseScale * zoom;
  const viewW = worldW * scale;
  const viewH = worldH * scale;
  const baseOffsetX = Math.floor((canvas.width - worldW * baseScale) / 2);
  const baseOffsetY = Math.floor((canvas.height - worldH * baseScale) / 2);
  const offsetX = baseOffsetX + (typeof camera?.panX === 'number' && Number.isFinite(camera.panX) ? camera.panX : 0);
  const offsetY = baseOffsetY + (typeof camera?.panY === 'number' && Number.isFinite(camera.panY) ? camera.panY : 0);
  return { scale, offsetX, offsetY, tileRender: tileSize * scale };
}

function drawGrid(ctx: CanvasRenderingContext2D, gridW: number, gridH: number, tile: number, t: Transform): void {
  ctx.save();
  ctx.translate(t.offsetX, t.offsetY);
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = Math.max(0.3, t.scale * 0.06);
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

function drawResourceTiles(
  ctx: CanvasRenderingContext2D,
  tiles: ReadonlyArray<{ x: number; y: number }>,
  t: Transform,
  assetName: string,
  fallbackColor: string,
): void {
  const useSvgs = !!window.__USE_SVGS__;
  ctx.save();
  for (const cell of tiles) {
    if (useSvgs && drawSvg(ctx, assetName, cell.x, cell.y, "N", t, 1.0)) {
      continue;
    }
    fillTile(ctx, cell.x, cell.y, fallbackColor, t);
  }
  ctx.restore();
}

function drawOre(ctx: CanvasRenderingContext2D, ore: ReadonlyArray<{ x: number; y: number }>, t: Transform): void {
  drawResourceTiles(ctx, ore, t, "iron-ore", ORE_COLOR);
}

function drawCoal(ctx: CanvasRenderingContext2D, coal: ReadonlyArray<{ x: number; y: number }>, t: Transform): void {
  drawResourceTiles(ctx, coal, t, "coal", COAL_COLOR);
}

function drawWood(ctx: CanvasRenderingContext2D, wood: ReadonlyArray<{ x: number; y: number }>, t: Transform): void {
  drawResourceTiles(ctx, wood, t, "tree", WOOD_COLOR);
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

function drawPlayerMarker(
  ctx: CanvasRenderingContext2D,
  gridW: number,
  gridH: number,
  t: Transform,
  snapshot: SnapshotWithOptionalPlayer,
  timeTick: number,
  motionEnabled: boolean,
): void {
  const animate = motionEnabled && !(typeof navigator !== "undefined" && navigator.webdriver === true);
  const player = snapshot.player;
  const px =
    player && Number.isFinite(player.x) ? Math.max(0, Math.min(gridW - 1, Math.floor(player.x))) : Math.floor(gridW / 2);
  const py =
    player && Number.isFinite(player.y) ? Math.max(0, Math.min(gridH - 1, Math.floor(player.y))) : Math.floor(gridH / 2);
  const fuel = typeof player?.fuel === "number" && Number.isFinite(player.fuel) ? Math.max(0, player.fuel) : 100;
  const maxFuel =
    typeof player?.maxFuel === "number" && Number.isFinite(player.maxFuel)
      ? Math.max(1, player.maxFuel)
      : 100;
  const fuelRatio = Math.max(0, Math.min(1, fuel / maxFuel));
  const bob = animate ? Math.sin(timeTick * 0.22) * t.tileRender * 0.015 : 0;
  const pulse = animate ? 1 + 0.03 * Math.sin(timeTick * 0.2 + 0.7) : 1;
  const playerDirectionCw: Direction = "E";
  const usedSvg = !!window.__USE_SVGS__ && drawSvg(
    ctx,
    "player",
    px,
    py,
    playerDirectionCw,
    t,
    0.72 * pulse,
    bob,
  );

  const cx = t.offsetX + (px + 0.5) * t.tileRender;
  const cy = t.offsetY + (py + 0.5) * t.tileRender;
  const radius = Math.max(4, t.tileRender * 0.18);
  if (!usedSvg) {
    const heading = radius * 1.45;
    const angle = dirToAngleRad(playerDirectionCw);

    ctx.save();
    ctx.fillStyle = "#4fd1ff";
    ctx.strokeStyle = "#0d2533";
    ctx.lineWidth = Math.max(1.25, t.tileRender * 0.04);
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1.25, t.tileRender * 0.05);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * heading, cy + Math.sin(angle) * heading);
    ctx.stroke();
    ctx.restore();
  }

  const barW = radius * 2.2;
  const barH = Math.max(2, t.tileRender * 0.07);
  const barX = cx - barW / 2;
  const barY = cy - radius - barH - Math.max(2, t.tileRender * 0.08);
  ctx.save();
  ctx.fillStyle = "#2c2c2c";
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = fuelRatio > 0.4 ? "#50fa7b" : fuelRatio > 0.2 ? "#ffb86c" : "#ff5555";
  ctx.fillRect(barX, barY, barW * fuelRatio, barH);
  ctx.restore();
}

function drawMiner(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rot: Direction,
  t: Transform,
  hasOutput: boolean | undefined,
  justMined: boolean | undefined,
  timeTick: number,
  motionEnabled: boolean,
): void {
  const animate = motionEnabled && !(typeof navigator !== "undefined" && navigator.webdriver === true);
  const active = hasOutput === true || justMined === true;
  const pulse =
    active && animate ? 1 + 0.03 * Math.sin(timeTick * 0.25 + x * 0.5 + y * 0.2) : 1;
  const bob = active && animate ? Math.sin(timeTick * 0.28 + x * 0.2) * t.tileRender * 0.01 : 0;
  if (!!window.__USE_SVGS__ && drawSvg(ctx, "miner", x, y, rot, t, pulse, bob)) return;
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
  timeTick: number,
  motionEnabled: boolean,
): void {
  const animate = motionEnabled && !(typeof navigator !== "undefined" && navigator.webdriver === true);
  const useSvgs = !!window.__USE_SVGS__;
  const px = t.offsetX + x * t.tileRender;
  const py = t.offsetY + y * t.tileRender;
  const laneCapacity = itemHint === undefined ? 0 : itemHint.length;
  const items = parseBeltItems(itemHint);
  const active = items.length > 0;
  const pulse =
    active && animate ? 1 + 0.02 * Math.sin(timeTick * 0.55 + x * 0.8 + y * 0.4) : 1;
  const bob =
    active && animate
      ? Math.sin(timeTick * 0.6 + x * 0.7 + y * 0.3) * t.tileRender * 0.008
      : 0;

  if (useSvgs && drawSvg(ctx, "transport-belt-basic-yellow", x, y, rot, t, pulse, bob)) {
    ctx.save();
    const cx = px + t.tileRender / 2;
    const cy = py + t.tileRender / 2;
    ctx.translate(cx, cy);
    ctx.rotate(dirToAngleRad(rot));
  } else {
    // Base belt body
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
  }

  // Items on belt (read from committed snapshot slot list)
  for (const it of items) {
    if (useSvgs) {
      const img = getSvg(it.kind);
      if (img && img.complete && img.naturalWidth > 0) {
        const iz = t.tileRender * 0.45;
        const ix = -t.tileRender * 0.25 + it.pos * (t.tileRender * 0.5);
        ctx.globalAlpha = 1.0;

        ctx.save();
        ctx.drawImage(img, ix - iz / 2, -iz / 2, iz, iz);
        ctx.restore();
        continue;
      }
    }

    const color =
      it.kind === "iron-ore"
        ? ITEM_ORE
        : it.kind === "iron-plate"
          ? ITEM_PLATE
          : it.kind === "coal"
            ? ITEM_COAL
            : it.kind === "iron-gear"
              ? ITEM_GEAR
              : it.kind === "wood"
                ? ITEM_WOOD
                : ITEM_GENERIC;
    const ix = -t.tileRender * 0.25 + it.pos * (t.tileRender * 0.5);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ix, 0, Math.max(2, t.tileRender * 0.08), 0, Math.PI * 2);
    ctx.fill();
  }

  const load = laneCapacity > 0 ? items.length / laneCapacity : 0;
  if (load >= 0.65) {
    drawConveyorLoadHint(ctx, px, py, t, load);
  }
  ctx.restore();
}

function drawSplitter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rot: Direction,
  itemHint: ReadonlyArray<ItemKind | null> | undefined,
  t: Transform,
  timeTick: number,
  motionEnabled: boolean,
): void {
  const animate = motionEnabled && !(typeof navigator !== "undefined" && navigator.webdriver === true);
  const px = t.offsetX + x * t.tileRender;
  const py = t.offsetY + y * t.tileRender;
  const items = parseBeltItems(itemHint);
  const laneCapacity = itemHint === undefined ? 0 : itemHint.length;
  const pulse = animate ? 1 + 0.02 * Math.sin(timeTick * 0.55 + x * 0.4 + y * 0.3) : 1;
  const hasItem = items.length > 0;

  const centerX = px + t.tileRender * 0.5;
  const centerY = py + t.tileRender * 0.5;
  const half = t.tileRender * 0.34;
  const pulseScale = hasItem && animate ? pulse : 1;
  const branchLength = t.tileRender * 0.44 * pulseScale;

  ctx.save();
  ctx.fillStyle = hasItem ? "#2f2f2f" : SPLITTER_COLOR;
  ctx.fillRect(
    centerX - half,
    centerY - t.tileRender * 0.08,
    t.tileRender * 0.68,
    t.tileRender * 0.16,
  );
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(dirToAngleRad(rot));
  ctx.fillStyle = SPLITTER_COLOR;
  ctx.beginPath();
  ctx.rect(-half, -t.tileRender * 0.04, t.tileRender * 0.65, t.tileRender * 0.08);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "rgba(240,240,240,0.7)";
  ctx.lineWidth = Math.max(1.4, t.tileRender * 0.035);
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(
    centerX + Math.cos(dirToAngleRad(rotateDirection(rot, -1))) * branchLength,
    centerY + Math.sin(dirToAngleRad(rotateDirection(rot, -1))) * branchLength,
  );
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(
    centerX + Math.cos(dirToAngleRad(rotateDirection(rot, 1))) * branchLength,
    centerY + Math.sin(dirToAngleRad(rotateDirection(rot, 1))) * branchLength,
  );
  ctx.stroke();

  ctx.beginPath();
  ctx.fillStyle = SPLITTER_COLOR;
  ctx.arc(centerX, centerY, t.tileRender * 0.05, 0, Math.PI * 2);
  ctx.fill();

  for (const it of items) {
    const img = getSvg(it.kind);
    if (img && img.complete && img.naturalWidth > 0) {
      const iconSize = t.tileRender * 0.32;
      const offsetY = it.kind === "coal" ? t.tileRender * 0.07 : -t.tileRender * 0.07;
      ctx.drawImage(img, centerX - iconSize / 2, centerY + offsetY, iconSize, iconSize);
      continue;
    }

    const color =
      it.kind === "iron-ore"
        ? ITEM_ORE
        : it.kind === "iron-plate"
          ? ITEM_PLATE
          : it.kind === "coal"
            ? ITEM_COAL
            : it.kind === "iron-gear"
              ? ITEM_GEAR
              : it.kind === "wood"
                ? ITEM_WOOD
                : ITEM_GENERIC;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(centerX, centerY, Math.max(2, t.tileRender * 0.07), 0, Math.PI * 2);
    ctx.fill();
  }

  const load = laneCapacity > 0 ? items.length / laneCapacity : 0;
  if (load >= 0.55) {
    drawConveyorLoadHint(ctx, px, py, t, load);
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
  motionEnabled: boolean,
): void {
  const animate = motionEnabled && !(typeof navigator !== "undefined" && navigator.webdriver === true);
  const active = state !== undefined && state !== "idle";
  const pulse =
    active && animate ? 1 + 0.025 * Math.sin(timeTick * 0.5 + x * 0.4 + y * 0.4) : 1;
  const bob = active && animate ? Math.sin(timeTick * 0.45 + x * 0.25) * t.tileRender * 0.01 : 0;
  if (!!window.__USE_SVGS__ && drawSvg(ctx, "basic-inserter", x, y, rot, t, pulse, bob)) return;

  const baseX = t.offsetX + (x + 0.5) * t.tileRender;
  const baseY = t.offsetY + (y + 0.5) * t.tileRender;
  ctx.save();
  // base
  ctx.fillStyle = INSERTER_BASE;
  ctx.beginPath();
  ctx.arc(baseX, baseY, Math.max(2, t.tileRender * 0.12), 0, Math.PI * 2);
  ctx.fill();

  // arm rotation: parse from state; fallback to time-based sweep
  const phase = parseInserterPhase(state, timeTick, animate);
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

function drawFurnace(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number | null,
  t: Transform,
  timeTick: number,
  motionEnabled: boolean,
): void {
  const animate = motionEnabled && !(typeof navigator !== "undefined" && navigator.webdriver === true);
  const useSvgs = !!window.__USE_SVGS__;
  const px = t.offsetX + x * t.tileRender;
  const py = t.offsetY + y * t.tileRender;
  const frac = progress !== null ? clamp01(progress) : 0;
  const active = frac > 0;
  const pulse =
    active && animate ? 1 + 0.03 * Math.sin(timeTick * 0.22 + x * 0.3 + y * 0.3) : 1;
  const bob =
    active && animate
      ? Math.sin(timeTick * 0.2 + x * 0.2 + y * 0.2) * t.tileRender * 0.006
      : 0;

  if (!useSvgs || !drawSvg(ctx, "furnace", x, y, "N", t, pulse, bob)) {
    ctx.save();
    // body
    ctx.fillStyle = FURNACE_COLOR;
    ctx.fillRect(px + 2, py + 2, Math.ceil(t.tileRender) - 4, Math.ceil(t.tileRender) - 4);
    ctx.restore();
  }

  // progress bar (bottom) overlay always drawn
  ctx.save();
  if (frac > 0 || !useSvgs) {
    const barW = (Math.ceil(t.tileRender) - 6) * frac;
    const barH = Math.max(3, Math.floor(t.tileRender * 0.12));
    ctx.fillStyle = frac > 0 ? "#ffe082" : "#444";
    ctx.fillRect(px + 3, py + Math.ceil(t.tileRender) - barH - 3, barW, barH);
  }
  ctx.restore();
}

function drawAssembler(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number | null,
  t: Transform,
  timeTick: number,
  motionEnabled: boolean,
): void {
  const animate = motionEnabled && !(typeof navigator !== "undefined" && navigator.webdriver === true);
  const useSvgs = !!window.__USE_SVGS__;
  const px = t.offsetX + x * t.tileRender;
  const py = t.offsetY + y * t.tileRender;
  const frac = progress !== null ? clamp01(progress) : 0;
  const active = frac > 0;
  const pulse =
    active && animate ? 1 + 0.02 * Math.sin(timeTick * 0.2 + x * 0.3 + y * 0.3) : 1;
  const bob =
    active && animate
      ? Math.sin(timeTick * 0.18 + x * 0.2 + y * 0.2) * t.tileRender * 0.006
      : 0;

  if (
    !useSvgs ||
    !drawSvg(ctx, "furnace", x, y, "N", t, pulse, bob)
  ) {
    const tile = Math.ceil(t.tileRender);
    const pad = Math.max(2, tile * 0.09);
    const body = tile - pad * 2;
    const topInset = pad + tile * 0.12;
    const midInset = pad + tile * 0.22;

    ctx.save();
    ctx.fillStyle = ASSEMBLER_COLOR;
    ctx.fillRect(px + pad, py + pad, body, body);

    ctx.fillStyle = active ? "rgba(255, 255, 255, 0.5)" : "rgba(255, 255, 255, 0.2)";
    ctx.fillRect(px + topInset, py + topInset, body - (topInset - pad) * 2, tile * 0.16);

    ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
    ctx.fillRect(px + midInset, py + midInset, body - (midInset - pad) * 2, tile * 0.16);

    ctx.fillStyle = active ? "#ffd56b" : "rgba(255, 213, 107, 0.55)";
    const barHeight = Math.max(2, tile * 0.06);
    const fillHeight = Math.max(3, Math.ceil(body * 0.6) * frac);
    ctx.fillRect(
      px + tile * 0.34,
      py + tile * 0.82 - fillHeight,
      tile * 0.1,
      fillHeight,
    );
    ctx.restore();
  }

  ctx.save();
  if (frac > 0 || !useSvgs) {
    const barW = (Math.ceil(t.tileRender) - 6) * frac;
    const barH = Math.max(3, Math.floor(t.tileRender * 0.12));
    ctx.fillStyle = frac > 0 ? "#ffe082" : "#444";
    ctx.fillRect(px + 3, py + Math.ceil(t.tileRender) - barH - 3, barW, barH);
  }

  ctx.fillStyle = active ? "#6bffd2" : "rgba(107, 255, 210, 0.42)";
  ctx.beginPath();
  ctx.arc(px + t.tileRender * 0.18, py + t.tileRender * 0.5, Math.max(1.6, t.tileRender * 0.06), 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = active ? "#bcaeff" : "rgba(188, 174, 255, 0.42)";
  ctx.beginPath();
  ctx.arc(px + t.tileRender * 0.82, py + t.tileRender * 0.5, Math.max(1.6, t.tileRender * 0.06), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawChest(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: Transform,
): void {
  const px = t.offsetX + x * t.tileRender;
  const py = t.offsetY + y * t.tileRender;
  const pad = Math.max(1.2, t.tileRender * 0.08);
  const innerPad = Math.max(2.4, t.tileRender * 0.18);
  const bodyW = Math.ceil(t.tileRender) - 2 * pad;
  const bodyH = Math.ceil(t.tileRender) - 2 * pad;

  // Always draw a clear fallback silhouette first so chest placement is visible even if
  // image loading stalls or fails.
  ctx.save();
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.38)";
  ctx.shadowBlur = Math.max(1.5, t.tileRender * 0.08);
  ctx.fillStyle = "#4f3a1c";
  ctx.strokeStyle = "#27170a";
  ctx.lineWidth = Math.max(1, t.tileRender * 0.05);
  ctx.beginPath();
  ctx.fillRect(px + pad, py + pad, bodyW, bodyH);
  ctx.strokeRect(px + pad + 0.5, py + pad + 0.5, bodyW - 1, bodyH - 1);

  const topOffset = t.tileRender * 0.2;
  const lidHeight = Math.max(2.5, t.tileRender * 0.11);
  ctx.fillStyle = "#6a4a22";
  ctx.fillRect(px + pad + 1, py + pad + 0.8, bodyW - 2, lidHeight);

  ctx.fillStyle = "rgba(0, 0, 0, 0.20)";
  ctx.fillRect(px + pad + 1, py + pad + topOffset, bodyW - 2, lidHeight);
  ctx.restore();

  ctx.restore();

  // Inner slot glow / divider.
  ctx.save();
  ctx.fillStyle = "rgba(238, 230, 214, 0.9)";
  ctx.fillRect(px + innerPad, py + innerPad, bodyW - innerPad * 0.95 * 2, t.tileRender * 0.1);

  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.fillRect(px + innerPad, py + innerPad * 1.8 + t.tileRender * 0.25, bodyW - innerPad * 1.9, t.tileRender * 0.06);

  ctx.fillStyle = "rgba(0, 0, 0, 0.24)";
  ctx.fillRect(px + innerPad, py + innerPad * 1.95 + t.tileRender * 0.55, bodyW - innerPad * 1.9, t.tileRender * 0.1);

  ctx.fillStyle = "#f3de6a";
  const handleX = px + bodyW * 0.53;
  const handleY = py + bodyW * 0.5;
  const handleW = Math.max(3, t.tileRender * 0.11);
  const handleH = Math.max(4, t.tileRender * 0.16);
  ctx.fillRect(handleX - handleW / 2, handleY - handleH / 2, handleW, handleH);
  ctx.restore();

  // Outer edge and lock marker.
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = Math.max(1, t.tileRender * 0.04);
  ctx.strokeRect(px + t.tileRender * 0.12, py + t.tileRender * 0.12, t.tileRender * 0.76, t.tileRender * 0.76);
  ctx.fillStyle = "#2f2f2f";
  ctx.strokeStyle = "#f7eed8";
  ctx.lineWidth = Math.max(1, t.tileRender * 0.035);
  ctx.beginPath();
  ctx.arc(px + t.tileRender * 0.5, py + t.tileRender * 0.5, Math.max(1.5, t.tileRender * 0.05), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (!!window.__USE_SVGS__) {
    drawSvg(ctx, "chest", x, y, "N", t, 0.96);
  }
}

function drawAccumulator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: Transform,
): void {
  const px = t.offsetX + x * t.tileRender;
  const py = t.offsetY + y * t.tileRender;
  const tile = Math.ceil(t.tileRender);
  const baseW = t.tileRender * 0.6;
  const baseH = t.tileRender * 0.2;
  const baseX = px + (t.tileRender - baseW) / 2;
  const baseY = py + t.tileRender * 0.72;
  const bodyW = t.tileRender * 0.32;
  const bodyH = t.tileRender * 0.38;
  const bodyX = px + (t.tileRender - bodyW) / 2;
  const bodyY = py + t.tileRender * 0.24;
  const capX = px + t.tileRender * 0.23;
  const capY = py + t.tileRender * 0.16;
  const capW = t.tileRender * 0.54;
  const capH = t.tileRender * 0.18;
  const indicatorX = px + t.tileRender * 0.5;
  const indicatorY = py + t.tileRender * 0.68;
  const radius = Math.max(1.4, tile * 0.035);

  ctx.save();
  ctx.fillStyle = "rgba(12, 14, 18, 0.72)";
  ctx.fillRect(baseX, baseY, baseW, baseH);
  ctx.fillStyle = "#0f161d";
  ctx.fillRect(capX, capY, capW, capH);

  ctx.fillStyle = ACCUMULATOR_COLOR;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
  ctx.lineWidth = Math.max(1, t.tileRender * 0.035);
  ctx.fillRect(bodyX, bodyY, bodyW, bodyH);
  ctx.strokeRect(bodyX, bodyY, bodyW, bodyH);

  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.beginPath();
  ctx.arc(indicatorX - t.tileRender * 0.08, indicatorY, radius * 1.1, 0, Math.PI * 2);
  ctx.arc(indicatorX + t.tileRender * 0.08, indicatorY, radius * 1.1, 0, Math.PI * 2);
  ctx.fill();

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

const drawConveyorLoadHint = (
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  t: Transform,
  load: number,
): void => {
  if (!Number.isFinite(load) || load <= 0.01) {
    return;
  }

  const laneWidth = Math.max(3, t.tileRender * 0.28);
  const laneX = px + (t.tileRender - laneWidth) / 2;
  const laneY = py + t.tileRender * 0.11;
  const laneHeight = Math.max(2.2, t.tileRender * 0.08);
  const clamped = Math.min(1, Math.max(0, load));
  const color = clamped >= 0.85 ? CONVEYOR_HINT_HIGH : clamped >= 0.55 ? CONVEYOR_HINT_MID : CONVEYOR_HINT_LOW;

  ctx.save();
  ctx.fillStyle = "rgba(30, 41, 59, 0.6)";
  ctx.fillRect(laneX, laneY, laneWidth, laneHeight);
  ctx.fillStyle = color;
  ctx.fillRect(laneX, laneY, laneWidth * clamped, laneHeight);
  ctx.restore();
};

function parseBeltItems(items: ReadonlyArray<ItemKind | null> | undefined): BeltItem[] {
  if (items === undefined) {
    return [];
  }

  const result: BeltItem[] = [];
  const denom = Math.max(1, items.length);

  for (let index = 0; index < items.length; index += 1) {
    const itemKind = items[index];
    if (
      itemKind !== "iron-ore" &&
      itemKind !== "iron-plate" &&
      itemKind !== "coal" &&
      itemKind !== "iron-gear" &&
      itemKind !== "wood"
    ) {
      continue;
    }

    result.push({
      kind: itemKind,
      pos: clamp01((index + 0.5) / denom),
    });
  }

  return result;
}

function parseInserterPhase(state: InserterState | undefined, tick: number, motionEnabled: boolean): number {
  const base = state === "pickup" ? 0.2 : state === "swing" ? 0.5 : state === "drop" ? 0.8 : 0.15;
  const sweep = motionEnabled ? ((tick % 20) / 20 - 0.5) * 0.12 : 0;
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
  setPaused(paused: boolean): void;
  setReducedMotionEnabled(enabled: boolean): void;
  requestRender(): void;
  resize?(width: number, height: number): void;
  destroy(): void;
};


const toBoundaryCounter = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value <= 0) {
    return 0;
  }

  return Math.floor(value);
};

type PlacementTiming = {
  tick: number | null;
  revision: number | null;
};

const readPlacementTiming = (sim: unknown): PlacementTiming => {
  if (sim === null || typeof sim !== "object") {
    return { tick: null, revision: null };
  }

  const withSnapshot = sim as {
    getPlacementSnapshot?: () => {
      tick?: unknown;
      tickCount?: unknown;
      revision?: unknown;
    };
    tick?: unknown;
    tickCount?: unknown;
  };

  if (typeof withSnapshot.getPlacementSnapshot === "function") {
    try {
      const placementSnapshot = withSnapshot.getPlacementSnapshot();
      const fromTick = toBoundaryCounter(placementSnapshot?.tick);
      if (fromTick !== null) {
        return {
          tick: fromTick,
          revision: toBoundaryCounter(placementSnapshot?.revision),
        };
      }

      const fromTickCount = toBoundaryCounter(placementSnapshot?.tickCount);
      if (fromTickCount !== null) {
        return {
          tick: fromTickCount,
          revision: toBoundaryCounter(placementSnapshot?.revision),
        };
      }

      return {
        tick: null,
        revision: toBoundaryCounter(placementSnapshot?.revision),
      };
    } catch {
      // Ignore and fall back to legacy fields below.
    }
  }

  const fromTick = toBoundaryCounter(withSnapshot.tick);
  if (fromTick !== null) {
    return {
      tick: fromTick,
      revision: toBoundaryCounter((withSnapshot as { revision?: unknown }).revision),
    };
  }

  return {
    tick: toBoundaryCounter(withSnapshot.tickCount),
    revision: toBoundaryCounter((withSnapshot as { revision?: unknown }).revision),
  };
};

export function createRenderer(canvas: HTMLCanvasElement): RendererApi {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable");
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  let ghost: { tile: Tile | null; valid: boolean } = { tile: null, valid: false };
  let committedTick: number | null = null;
  let committedRevision: number | null = null;
  let committedSnapshot: Snapshot | null = null;
  let lastRenderedTick: number | null = null;
  let lastRenderedRevision: number | null = null;
  let lastRenderedGhostSignature = "null";
  let lastRenderedPaused = false;
  let lastRenderedSvgs = !!window.__USE_SVGS__;
  let reducedMotionEnabled = false;
  let lastRenderedReducedMotion = false;
  let rafId: number | null = null;
  let renderQueued = false;
  let destroyed = false;
  let isPaused = false;
  let camera: CameraTransform = { zoom: 1, panX: 0, panY: 0 };

  const readSnapshot = (): Snapshot | null => {
    const sim = window.__SIM__;
    if (typeof sim !== "object" || sim === null) {
      committedTick = null;
      committedSnapshot = null;
      return null;
    }

    const { tick: nextTick, revision: nextRevision } = readPlacementTiming(sim);
    const nextRevisionValue = nextRevision === null ? 0 : nextRevision;
    if (nextTick === null && nextRevision === null) {
      try {
        const snapshot = createSnapshot(sim);
        const snapshotTick = toBoundaryCounter(snapshot.time.tick);
        const snapshotRevision = toBoundaryCounter(snapshot.time.revision);
        if (committedSnapshot !== null && committedTick === snapshotTick && committedRevision === snapshotRevision) {
          return committedSnapshot;
        }
        committedSnapshot = snapshot;
        committedTick = snapshotTick;
        committedRevision = snapshotRevision;
        return snapshot;
      } catch {
        return null;
      }
    }

    if (committedSnapshot !== null && committedTick === nextTick && committedRevision === nextRevisionValue) {
      return committedSnapshot;
    }

    try {
      const snapshot = createSnapshot(sim);
      const snapshotTick = toBoundaryCounter(snapshot.time.tick);
      const snapshotRevision = toBoundaryCounter(snapshot.time.revision);
      committedSnapshot = snapshot;
      committedTick = snapshotTick;
      committedRevision = snapshotRevision === null ? nextRevisionValue : snapshotRevision;
      return snapshot;
    } catch {
      if (committedSnapshot !== null && committedTick === nextTick && committedRevision === nextRevisionValue) {
        return committedSnapshot;
      }
      return null;
    }
  };

  const draw = (): void => {
    if (destroyed) return;

    const snapshot = readSnapshot();
    if (snapshot === null) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }

    const snapshotTick = toBoundaryCounter(snapshot.time.tick);
    const snapshotRevision = toBoundaryCounter(snapshot.time.revision);
    const ghostSignature = ghost.tile === null
      ? "null"
      : `${ghost.tile.x},${ghost.tile.y}:${ghost.valid ? 1 : 0}`;
    const nextSvgs = !!window.__USE_SVGS__;
    const motionEnabled = !reducedMotionEnabled && !(typeof navigator !== "undefined" && navigator.webdriver === true);

    if (
      snapshotTick !== null &&
      snapshotRevision !== null &&
      snapshotTick === lastRenderedTick &&
      snapshotRevision === lastRenderedRevision &&
      ghostSignature === lastRenderedGhostSignature &&
      isPaused === lastRenderedPaused &&
      lastRenderedSvgs === nextSvgs &&
      lastRenderedReducedMotion === reducedMotionEnabled
    ) {
      return;
    }

    // Canvas clearing
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const gridW = snapshot.grid.width;
    const gridH = snapshot.grid.height;
    const tile = snapshot.grid.tileSize;
    if (gridW <= 0 || gridH <= 0) {
      // No valid world dimensions yet; render on next update.
      return;
    }

    const t = computeTransform(canvas, gridW, gridH, tile, camera);

    // Layers
    drawGrid(ctx, gridW, gridH, tile, t);
    drawOre(ctx, snapshot.ore, t);
    drawCoal(ctx, snapshot.coal, t);
    drawWood(ctx, snapshot.wood, t);

    // Entities
    for (const e of snapshot.entities) {
      switch (e.kind as EntityKind) {
        case "miner":
          drawMiner(ctx, e.pos.x, e.pos.y, e.rot, t, e.hasOutput, e.justMined, snapshot.time.tick, motionEnabled);
          break;
        case "belt":
          drawBelt(ctx, e.pos.x, e.pos.y, e.rot, e.items, t, snapshot.time.tick, motionEnabled);
          break;
        case "splitter":
          drawSplitter(ctx, e.pos.x, e.pos.y, e.rot, e.items, t, snapshot.time.tick, motionEnabled);
          break;
        case "inserter":
          drawInserter(ctx, e.pos.x, e.pos.y, e.rot, e.state, t, snapshot.time.tick, motionEnabled);
          break;
        case "furnace": {
          const progress = parseFurnaceProgress(e.progress01);
          drawFurnace(ctx, e.pos.x, e.pos.y, progress, t, snapshot.time.tick, motionEnabled);
          break;
        }
        case "chest":
          drawChest(ctx, e.pos.x, e.pos.y, t);
          break;
      case "assembler": {
        const progress = parseFurnaceProgress(e.progress01);
        drawAssembler(ctx, e.pos.x, e.pos.y, progress, t, snapshot.time.tick, motionEnabled);
        break;
      }
      case "solar-panel":
        drawSvg(ctx, "solar-panel", e.pos.x, e.pos.y, "N", t, 0.95);
        break;
      case "accumulator":
        drawAccumulator(ctx, e.pos.x, e.pos.y, t);
        break;
      default:
        // resource/unknown: skip
        break;
      }
    }

    const snapshotWithPlayer = snapshot as SnapshotWithOptionalPlayer;
    drawPlayerMarker(ctx, gridW, gridH, t, snapshotWithPlayer, snapshot.time.tick, motionEnabled);

    // Ghost highlight on top
    drawGhost(ctx, ghost, t);
    committedTick = snapshot.time.tick;
    lastRenderedTick = snapshotTick;
    lastRenderedRevision = snapshotRevision;
    lastRenderedGhostSignature = ghostSignature;
    lastRenderedPaused = isPaused;
    lastRenderedSvgs = nextSvgs;
    lastRenderedReducedMotion = reducedMotionEnabled;
  };

  const requestRender = (): void => {
    if (destroyed || renderQueued) {
      return;
    }
    renderQueued = true;
    rafId = window.requestAnimationFrame((): void => {
      renderQueued = false;
      draw();
    });
  };

  // Kick off loop
  requestRender();

  return {
    setGhost(tile: Tile | null, valid: boolean): void {
      ghost = { tile, valid };
      requestRender();
    },
    setPaused(paused: boolean): void {
      isPaused = paused;
      requestRender();
    },
    setReducedMotionEnabled(enabled: boolean): void {
      reducedMotionEnabled = !!enabled;
      requestRender();
    },
    setCamera(nextCamera: CameraTransform): void {
      const nextZoom = typeof nextCamera.zoom === 'number' && Number.isFinite(nextCamera.zoom)
        ? Math.max(0.05, nextCamera.zoom)
        : camera.zoom;
      const nextPanX = typeof nextCamera.panX === 'number' && Number.isFinite(nextCamera.panX)
        ? nextCamera.panX
        : camera.panX;
      const nextPanY = typeof nextCamera.panY === 'number' && Number.isFinite(nextCamera.panY)
        ? nextCamera.panY
        : camera.panY;
      camera = {
        zoom: nextZoom,
        panX: nextPanX,
        panY: nextPanY,
      };
      requestRender();
    },
    requestRender(): void {
      requestRender();
    },
    resize(): void {
      requestRender();
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
