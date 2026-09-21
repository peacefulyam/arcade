// ─────────────────────────────────────────────────────────────────────────────
// breakout/custom.ts — PLAYER-DESIGNED levels ("custom mode").
//
// The loop: the drawing-app editor (CustomEditor.tsx) paints WALL CELLS on a
// grid covering the top 75% of the field. This module turns that grid into a
// playable level in two steps:
//
//   1. wallsFromGrid — merge horizontal runs of wall cells into solid WallRect
//      colliders (clean faces, no per-cell seams for the ball to catch on).
//   2. autoFillBricks — tile the same region with HALF-SIZE bricks, skipping
//      any brick that overlaps a wall cell or a user-erased cutout, ending
//      a slider-chosen block-height gap above the paddle.
//
// The def stores the walls plus fill refinements (fillTop, erased cutouts);
// bricks are re-derived at load time. Everything here is pure and
// headless-testable except the localStorage corner at the bottom.
// ─────────────────────────────────────────────────────────────────────────────
import { createInitialState } from "./engine";
import type {
  BreakoutConfig,
  BreakoutState,
  BrickState,
  CustomLevelDef,
  WallRect,
} from "./types";

/** Drawing grid: 100 columns across the field → square 4.8px cells. */
export const GRID_COLS = 100;
/** Editable vertical span: the top 75% of the 600px field. */
export const EDIT_BOTTOM = 450;
/** Square cell size in world px (worldW 480 / 100 cols). */
export const CELL = 4.8;
/** Grid rows that fit in the editable span (93 × 4.8 = 446.4px). */
export const GRID_ROWS = Math.floor(EDIT_BOTTOM / CELL);
/** Pixel height the grid actually covers. */
export const GRID_H = GRID_ROWS * CELL;

/**
 * Gap between the lowest fill blocks and the paddle, in BLOCK HEIGHTS —
 * the editor slider's unit. 2 keeps the launch corridor clear; 30 leaves a
 * ~10-row field. Default 10 reproduces the classic field exactly
 * (paddleY 560 − 10 × blockH 11 = 450).
 */
export const MIN_GAP_BLOCKS = 2;
export const MAX_GAP_BLOCKS = 30;
export const DEFAULT_GAP_BLOCKS = 10;

export function normalizeGapBlocks(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return DEFAULT_GAP_BLOCKS;
  return Math.min(MAX_GAP_BLOCKS, Math.max(MIN_GAP_BLOCKS, Math.round(v)));
}

function validRect(r: unknown): r is WallRect {
  if (typeof r !== "object" || r === null) return false;
  const q = r as WallRect;
  return (
    Number.isFinite(q.x) &&
    Number.isFinite(q.y) &&
    Number.isFinite(q.w) &&
    Number.isFinite(q.h) &&
    q.w > 0 &&
    q.h > 0
  );
}

/** Drop malformed cutouts (hand-edited saves); valid ones pass through. */
export function normalizeRemoved(r: unknown): WallRect[] {
  return Array.isArray(r) ? r.filter(validRect) : [];
}

/** All-clear grid (fresh editor canvas). */
export function blankGrid(): Uint8Array {
  return new Uint8Array(GRID_COLS * GRID_ROWS);
}

/** All-clear rows (fresh stored def). */
export function blankRows(): string[] {
  return Array.from({ length: GRID_ROWS }, () => "0".repeat(GRID_COLS));
}

export function rowsToGrid(rows: string[]): Uint8Array {
  const grid = blankGrid();
  for (let r = 0; r < GRID_ROWS; r++) {
    const row = rows[r] ?? "";
    for (let c = 0; c < GRID_COLS; c++) {
      grid[r * GRID_COLS + c] = row[c] === "1" ? 1 : 0;
    }
  }
  return grid;
}

export function gridToRows(grid: Uint8Array): string[] {
  const rows: string[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    let s = "";
    for (let c = 0; c < GRID_COLS; c++) {
      s += grid[r * GRID_COLS + c] === 1 ? "1" : "0";
    }
    rows.push(s);
  }
  return rows;
}

export function countWallCells(grid: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === 1) n++;
  return n;
}

/**
 * Merge each row's consecutive wall cells into one rect per run. A solid
 * painted bar becomes ONE collider, so a ball skimming along it meets a flat
 * face instead of dozens of cell corners.
 */
export function wallsFromGrid(grid: Uint8Array): WallRect[] {
  const walls: WallRect[] = [];
  for (let r = 0; r < GRID_ROWS; r++) {
    let c = 0;
    while (c < GRID_COLS) {
      if (grid[r * GRID_COLS + c] !== 1) {
        c++;
        continue;
      }
      let end = c;
      while (end + 1 < GRID_COLS && grid[r * GRID_COLS + end + 1] === 1) end++;
      walls.push({
        x: c * CELL,
        y: r * CELL,
        w: (end - c + 1) * CELL,
        h: CELL,
      });
      c = end + 1;
    }
  }
  return walls;
}

/** Fill palette for auto bricks: amber / phosphor / bone, banded by row. */
const FILL_PALETTE = [0xf0b429, 0x9ee86e, 0xece7db];

/**
 * Tile the region with HALF-SIZE bricks (half the standard width AND height),
 * centered with a small padding gap. The field always starts at the built-in
 * brickTop; `gapBlocks` (the editor slider, in BLOCK heights) sets how far
 * above the paddle it ENDS. Two vetoes, either of which drops a brick:
 *   - wall overlap: any brick touching a wall cell is dropped — bricks never
 *     overlap walls, even partially;
 *   - cutouts: any brick whose CENTER falls inside a `removed` rect is
 *     dropped (the editor's per-block eraser). Rects — not fill-grid cells —
 *     so erasures survive slider moves that reshape the grid.
 */
export function autoFillBricks(
  config: BreakoutConfig,
  grid: Uint8Array,
  gapBlocks: number = DEFAULT_GAP_BLOCKS,
  removed: WallRect[] = [],
): BrickState[] {
  // Mirror levels.ts's derivation so "half-size" tracks the shipped tuning.
  const stdW =
    (config.worldW -
      config.brickSide * 2 -
      config.brickGap * (config.brickCols - 1)) /
    config.brickCols;
  const bw = stdW / 2;
  const bh = config.brickH / 2;
  const pad = 4;

  const x0 = config.brickSide;
  const x1 = config.worldW - config.brickSide;
  const y0 = config.brickTop;
  const y1 = config.paddleY - normalizeGapBlocks(gapBlocks) * bh;
  const cols = Math.max(1, Math.floor((x1 - x0 + pad) / (bw + pad)));
  const rows = Math.max(1, Math.floor((y1 - y0 + pad) / (bh + pad)));
  const ox = x0 + (x1 - x0 - (cols * bw + (cols - 1) * pad)) / 2;
  const oy = y0 + (y1 - y0 - (rows * bh + (rows - 1) * pad)) / 2;
  const cutouts = normalizeRemoved(removed);

  // Any wall cell under the brick's footprint vetoes it (out-of-grid = empty).
  const overlapsWall = (x: number, y: number): boolean => {
    const c0 = Math.floor(x / CELL);
    const c1 = Math.floor((x + bw - 1e-6) / CELL);
    const r0 = Math.floor(y / CELL);
    const r1 = Math.floor((y + bh - 1e-6) / CELL);
    for (let r = r0; r <= r1; r++) {
      if (r < 0 || r >= GRID_ROWS) continue;
      for (let c = c0; c <= c1; c++) {
        if (c < 0 || c >= GRID_COLS) continue;
        if (grid[r * GRID_COLS + c] === 1) return true;
      }
    }
    return false;
  };

  // Erased iff the brick's center sits inside a cutout rect.
  const cutOut = (x: number, y: number): boolean => {
    const cx = x + bw / 2;
    const cy = y + bh / 2;
    return cutouts.some(
      (q) => cx >= q.x && cx <= q.x + q.w && cy >= q.y && cy <= q.y + q.h,
    );
  };

  const bricks: BrickState[] = [];
  let id = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = ox + c * (bw + pad);
      const y = oy + r * (bh + pad);
      if (overlapsWall(x, y) || cutOut(x, y)) continue;
      const color = FILL_PALETTE[r % FILL_PALETTE.length];
      bricks.push({
        id: id++,
        col: c,
        row: r,
        x,
        y,
        w: bw,
        h: bh,
        hp: 1,
        maxHp: 1,
        color,
        alive: true,
      });
    }
  }
  return bricks;
}

/**
 * Fresh sim for a custom def: standard paddle/ball/lives, auto-filled bricks,
 * merged wall colliders. Built on createInitialState so custom mode inherits
 * every base rule (launch, steering, scoring, win/lose) unchanged.
 */
export function createCustomState(
  config: BreakoutConfig,
  def: CustomLevelDef,
): BreakoutState {
  const state = createInitialState(config, 0);
  const grid = rowsToGrid(def.rows);
  // NOTE: legacy `fillTop` is deliberately ignored (it aimed the wrong end
  // of the field); those saves fall back to the default paddle gap while
  // walls and erasures carry over untouched.
  state.bricks = autoFillBricks(config, grid, def.blockGap, def.removed);
  state.walls = wallsFromGrid(grid);
  return state;
}

// ── Persistence (the only impure corner) ─────────────────────────────────────

const STORE_KEY = "arcade.breakout.custom-levels.v1";

function validRows(rows: unknown): rows is string[] {
  return (
    Array.isArray(rows) &&
    rows.length === GRID_ROWS &&
    rows.every(
      (r) =>
        typeof r === "string" &&
        r.length === GRID_COLS &&
        /^[01]+$/.test(r),
    )
  );
}

function validDef(e: unknown): e is CustomLevelDef {
  if (typeof e !== "object" || e === null) return false;
  const d = e as CustomLevelDef;
  return (
    typeof d.id === "string" &&
    typeof d.name === "string" &&
    validRows(d.rows) &&
    typeof d.createdAt === "number" &&
    typeof d.updatedAt === "number" &&
    // Refinements are optional (older saves); when present they must be
    // well-shaped — normalizeGapBlocks/normalizeRemoved forgive the rest.
    // Legacy `fillTop` is accepted but ignored (see createCustomState).
    (d.blockGap === undefined || typeof d.blockGap === "number") &&
    (d.fillTop === undefined || typeof d.fillTop === "number") &&
    (d.removed === undefined || Array.isArray(d.removed))
  );
}

/** Load saved levels; corrupt entries are dropped, never thrown. */
export function loadCustomLevels(): CustomLevelDef[] {
  if (typeof window === "undefined") return []; // server prerender: empty
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validDef);
  } catch {
    return [];
  }
}

/** Overwrite the saved list (create/edit/delete all funnel through here). */
export function persistCustomLevels(levels: CustomLevelDef[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(levels));
  } catch {
    // Full or blocked storage: levels stay in memory for this session.
  }
}

export function newCustomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `custom-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}
