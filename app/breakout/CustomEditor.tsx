// ─────────────────────────────────────────────────────────────────────────────
// CustomEditor.tsx — the custom-level DRAWING APP + preview window.
//
// Drawing canvas: paint wall cells with pointer drag (left = current tool,
// right-button = erase for that stroke); the Hide/show blocks tool sweeps a
// half-block brush to hide blocks (or their dashed outlines to show them),
// and the slider sets the paddle gap in block heights. Below: a live preview
// showing exactly what the game will load —
// slate walls plus the auto-filled half-size bricks from custom.ts (same
// functions, so preview never drifts from gameplay). Save persists to
// localStorage; Playtest hands the current work (saved or not) to the game.
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_CONFIG } from "@/lib/breakout/config";
import {
  CELL,
  GRID_COLS,
  GRID_H,
  GRID_ROWS,
  MAX_GAP_BLOCKS,
  MIN_GAP_BLOCKS,
  autoFillBricks,
  blankRows,
  countWallCells,
  gridToRows,
  newCustomId,
  normalizeGapBlocks,
  normalizeRemoved,
  rowsToGrid,
  wallsFromGrid,
} from "@/lib/breakout/custom";
import type { CustomLevelDef, WallRect } from "@/lib/breakout/types";

const WORLD_W = DEFAULT_CONFIG.worldW; // 480
const WORLD_H = DEFAULT_CONFIG.worldH; // 600
const WALL_CSS = "#5b6b8c"; // must match renderer.rebuildWalls
const FILL_CSS = ["#f0b429", "#9ee86e", "#ece7db"]; // banded by row, like game

interface Props {
  /** Null = brand-new level; otherwise the saved def being edited. */
  initial: CustomLevelDef | null;
  onSave: (level: CustomLevelDef) => void;
  onPlay: (level: CustomLevelDef) => void;
  onCancel: () => void;
}

/**
 * Editor tools. Hide and Show are SEPARATE tools (not one inferred-mode
 * button): the pressed tool always does exactly what its label says, whether
 * the stroke starts on a block, a ghost, or empty canvas.
 */
type Tool = "draw" | "erase" | "hide" | "show";

/** An in-progress pointer stroke: wall-cell painting or block brushing. */
type Stroke =
  | { kind: "wall"; value: 0 | 1; lastC: number; lastR: number }
  | {
      kind: "blocks";
      mode: "hide" | "show";
      lastX: number;
      lastY: number;
      /** Brick keys already hidden this stroke (dedupes slow drags). */
      seen: Set<string>;
    };

/** Hide/show brush radius: ~half a block wide (blocks are 24×11). */
const BRUSH_R = 6;

function discHitsRect(
  x: number,
  y: number,
  r: number,
  q: { x: number; y: number; w: number; h: number },
): boolean {
  const cx = Math.max(q.x, Math.min(x, q.x + q.w));
  const cy = Math.max(q.y, Math.min(y, q.y + q.h));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function css(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** One button inside a segmented tool group. */
function SegButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1 text-xs ${
        active ? "bg-phosphor font-bold text-cabinet" : "text-dim hover:text-bone"
      }`}
    >
      {children}
    </button>
  );
}

export default function CustomEditor({ initial, onSave, onPlay, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  // Parent keys on the edited level's id, so this initializer runs fresh for
  // each level (or blank for "new") — no stale-grid bugs.
  const [grid, setGrid] = useState<Uint8Array>(() =>
    rowsToGrid(initial?.rows ?? blankRows()),
  );
  const [tool, setTool] = useState<Tool>("draw");
  const [showGrid, setShowGrid] = useState(true);
  // Gap between the lowest blocks and the paddle, in block heights (slider),
  // plus erased-block cutouts. Cutouts are world-px rects, so they stay put
  // when the slider reshapes the fill grid (see custom.ts).
  const [gapBlocks, setGapBlocks] = useState(() =>
    normalizeGapBlocks(initial?.blockGap),
  );
  const [removed, setRemoved] = useState<WallRect[]>(() =>
    normalizeRemoved(initial?.removed),
  );
  const editRef = useRef<HTMLCanvasElement | null>(null);
  const prevRef = useRef<HTMLCanvasElement | null>(null);
  // Wall strokes paint cells; block strokes sweep the hide/show brush.
  const strokeRef = useRef<Stroke | null>(null);

  // Same derivation the game loads — preview IS the level, minus motion.
  const walls = useMemo(() => wallsFromGrid(grid), [grid]);
  const bricks = useMemo(
    () => autoFillBricks(DEFAULT_CONFIG, grid, gapBlocks, removed),
    [grid, gapBlocks, removed],
  );
  const wallCells = useMemo(() => countWallCells(grid), [grid]);

  // ── Painting ─────────────────────────────────────────────────────────────
  const pointFromEvent = (e: React.PointerEvent): { x: number; y: number } | null => {
    const canvas = editRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * WORLD_W,
      y: ((e.clientY - rect.top) / rect.height) * WORLD_H,
    };
  };

  const cellFromEvent = (e: React.PointerEvent): { c: number; r: number } | null => {
    const p = pointFromEvent(e);
    if (!p) return null;
    const c = Math.floor(p.x / CELL);
    const r = Math.floor(p.y / CELL);
    if (c < 0 || c >= GRID_COLS || r < 0 || r >= GRID_ROWS) return null;
    return { c, r };
  };

  // Paint a line of cells (so fast drags don't leave dotted gaps), copying
  // the grid once per event. Returns the previous array when nothing changed
  // so React bails out.
  const dab = (c0: number, r0: number, c1: number, r1: number, value: 0 | 1) => {
    setGrid((prev) => {
      const next = new Uint8Array(prev);
      const steps = Math.max(Math.abs(c1 - c0), Math.abs(r1 - r0), 1);
      let changed = false;
      for (let i = 0; i <= steps; i++) {
        const c = Math.round(c0 + ((c1 - c0) * i) / steps);
        const r = Math.round(r0 + ((r1 - r0) * i) / steps);
        const idx = r * GRID_COLS + c;
        if (next[idx] !== value) {
          next[idx] = value;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  };

  // Blocks tool, HIDE leg: hide every fill block the brush disc touches
  // along the segment. Deduped per stroke AND against state, so slow drags
  // can't stack duplicate cutouts.
  const paintHide = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    seen: Set<string>,
  ) => {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / (BRUSH_R / 2)));
    // Brush bounding box (plus a brick diagonal of slack) so long sweeps
    // only test nearby blocks instead of the whole field per sample.
    const bx0 = Math.min(x0, x1) - BRUSH_R - 30;
    const bx1 = Math.max(x0, x1) + BRUSH_R + 30;
    const by0 = Math.min(y0, y1) - BRUSH_R - 30;
    const by1 = Math.max(y0, y1) + BRUSH_R + 30;
    const fresh: WallRect[] = [];
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      const y = y0 + ((y1 - y0) * i) / steps;
      for (const b of bricks) {
        if (b.x > bx1 || b.x + b.w < bx0 || b.y > by1 || b.y + b.h < by0) {
          continue;
        }
        const key = `${b.x},${b.y}`;
        if (seen.has(key)) continue;
        if (!discHitsRect(x, y, BRUSH_R, b)) continue;
        seen.add(key);
        fresh.push({ x: b.x, y: b.y, w: b.w, h: b.h });
      }
    }
    if (fresh.length === 0) return;
    setRemoved((prev) => {
      const known = new Set(prev.map((q) => `${q.x},${q.y},${q.w},${q.h}`));
      const add = fresh.filter(
        (q) => !known.has(`${q.x},${q.y},${q.w},${q.h}`),
      );
      return add.length > 0 ? [...prev, ...add] : prev;
    });
  };

  // Blocks tool, SHOW leg: delete every cutout the brush disc touches along
  // the segment (idempotent — re-sweeping changes nothing).
  const paintShow = (x0: number, y0: number, x1: number, y1: number) => {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / (BRUSH_R / 2)));
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      pts.push({ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps });
    }
    setRemoved((prev) => {
      const next = prev.filter(
        (q) => !pts.some((p) => discHitsRect(p.x, p.y, BRUSH_R, q)),
      );
      return next.length === prev.length ? prev : next;
    });
  };

  const pointInRect = (x: number, y: number, q: WallRect): boolean =>
    x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h;

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (tool === "hide" || tool === "show") {
      // No press-point inference: Hide always hides, Show always shows. A
      // bare click touches only what it lands on; dragging sweeps the brush.
      const p = pointFromEvent(e);
      if (!p) return;
      const seen = new Set<string>();
      if (tool === "show") {
        setRemoved((prev) => prev.filter((q) => !pointInRect(p.x, p.y, q)));
      } else {
        const hit = bricks.find((b) => pointInRect(p.x, p.y, b));
        if (hit) {
          seen.add(`${hit.x},${hit.y}`);
          const rect = { x: hit.x, y: hit.y, w: hit.w, h: hit.h };
          setRemoved((prev) =>
            prev.some(
              (q) => q.x === rect.x && q.y === rect.y && q.w === rect.w && q.h === rect.h,
            )
              ? prev
              : [...prev, rect],
          );
        }
      }
      strokeRef.current = {
        kind: "blocks",
        mode: tool,
        lastX: p.x,
        lastY: p.y,
        seen,
      };
      return;
    }
    const cell = cellFromEvent(e);
    if (!cell) return;
    // Right-button always erases for this stroke, whatever the tool says.
    const value: 0 | 1 = (e.button === 2 ? "erase" : tool) === "draw" ? 1 : 0;
    strokeRef.current = { kind: "wall", value, lastC: cell.c, lastR: cell.r };
    dab(cell.c, cell.r, cell.c, cell.r, value);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = strokeRef.current;
    if (!s) return;
    if (e.buttons === 0) {
      strokeRef.current = null; // pointer left the stroke without a button
      return;
    }
    if (s.kind === "blocks") {
      const p = pointFromEvent(e);
      if (!p) return;
      if (s.mode === "hide") paintHide(s.lastX, s.lastY, p.x, p.y, s.seen);
      else paintShow(s.lastX, s.lastY, p.x, p.y);
      s.lastX = p.x;
      s.lastY = p.y;
      return;
    }
    const cell = cellFromEvent(e);
    if (!cell) return;
    dab(s.lastC, s.lastR, cell.c, cell.r, s.value);
    s.lastC = cell.c;
    s.lastR = cell.r;
  };
  const endStroke = () => {
    strokeRef.current = null;
  };

  // ── Editor canvas: walls + grid + paddle-zone context ────────────────────
  useEffect(() => {
    const canvas = editRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#17171d";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // Fill blocks first (walls draw over any shared edge pixels)…
    for (const b of bricks) {
      ctx.fillStyle = FILL_CSS[b.row % FILL_CSS.length] ?? css(b.color);
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }

    ctx.fillStyle = WALL_CSS;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        if (grid[r * GRID_COLS + c] === 1) {
          ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
        }
      }
    }

    // …then erased-block ghosts: dashed amber outlines, click to add back.
    if (removed.length > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(240,180,41,0.85)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 2]);
      for (const q of removed) {
        ctx.strokeRect(q.x + 0.5, q.y + 0.5, q.w - 1, q.h - 1);
      }
      ctx.restore();
    }

    if (showGrid) {
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 1; c < GRID_COLS; c++) {
        ctx.moveTo(c * CELL + 0.5, 0);
        ctx.lineTo(c * CELL + 0.5, GRID_H);
      }
      for (let r = 1; r < GRID_ROWS; r++) {
        ctx.moveTo(0, r * CELL + 0.5);
        ctx.lineTo(WORLD_W, r * CELL + 0.5);
      }
      ctx.stroke();
    }

    // Editable-area frame + the (shaded, uneditable) ball/paddle zone below.
    ctx.strokeStyle = "#2a2a33";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, WORLD_W - 2, GRID_H - 2);
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, GRID_H, WORLD_W, WORLD_H - GRID_H);
    ctx.fillStyle = "#a8a294";
    ctx.font = "11px monospace";
    ctx.fillText("ball + paddle zone — not editable", 12, GRID_H + 22);

    // Paddle + ball ghosts so wall designs keep the rally in mind.
    ctx.fillStyle = "rgba(236,231,219,0.55)";
    ctx.fillRect(
      WORLD_W / 2 - DEFAULT_CONFIG.paddleW / 2,
      DEFAULT_CONFIG.paddleY,
      DEFAULT_CONFIG.paddleW,
      DEFAULT_CONFIG.paddleH,
    );
    ctx.beginPath();
    ctx.arc(
      WORLD_W / 2,
      DEFAULT_CONFIG.paddleY - DEFAULT_CONFIG.ballRadius - 1,
      DEFAULT_CONFIG.ballRadius,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = "rgba(158,232,110,0.55)";
    ctx.fill();
  }, [grid, bricks, removed, showGrid]);

  // ── Preview canvas: walls + auto-filled half-size bricks, as played ──────
  useEffect(() => {
    const canvas = prevRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#101014";
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    ctx.fillStyle = WALL_CSS;
    for (const w of walls) ctx.fillRect(w.x, w.y, w.w, w.h);

    for (const b of bricks) {
      ctx.fillStyle = FILL_CSS[b.row % FILL_CSS.length] ?? css(b.color);
      ctx.fillRect(b.x, b.y, b.w, b.h);
    }
  }, [walls, bricks]);

  const buildDef = (): CustomLevelDef => {
    const now = Date.now();
    return {
      id: initial?.id ?? newCustomId(),
      name: name.trim() || "Untitled custom level",
      rows: gridToRows(grid),
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
      blockGap: gapBlocks,
      removed,
    };
  };

  const btn =
    "rounded border border-line px-2 py-1 text-xs text-dim hover:text-bone";
  const btnActive =
    "rounded border border-phosphor px-2 py-1 text-xs font-bold text-phosphor";

  // One-line how-to for the active tool — the canvas caption says WHERE.
  const toolHint =
    tool === "draw"
      ? `Draw walls: drag on the editor canvas to paint the ${GRID_COLS}×${GRID_ROWS} grid.`
      : tool === "erase"
        ? "Erase walls: drag to remove wall cells (right-drag erases in any wall tool)."
        : tool === "hide"
          ? "Hide blocks: click or drag the half-block brush over blocks to hide them."
          : "Show blocks: click or drag over dashed outlines to bring blocks back.";

  return (
    <div>
      {/* Tool groups: one segmented control per family, actions after */}
      <div className="mb-2 flex flex-wrap items-end gap-x-5 gap-y-2">
        <div>
          <p className="mb-1 text-[11px] text-dim">Walls</p>
          <div className="flex divide-x divide-line overflow-hidden rounded border border-line">
            <SegButton active={tool === "draw"} onClick={() => setTool("draw")}>
              Draw
            </SegButton>
            <SegButton active={tool === "erase"} onClick={() => setTool("erase")}>
              Erase
            </SegButton>
          </div>
        </div>
        <div>
          <p className="mb-1 text-[11px] text-dim">Blocks</p>
          <div className="flex divide-x divide-line overflow-hidden rounded border border-line">
            <SegButton active={tool === "hide"} onClick={() => setTool("hide")}>
              Hide
            </SegButton>
            <SegButton active={tool === "show"} onClick={() => setTool("show")}>
              Show
            </SegButton>
          </div>
        </div>
        <div>
          <p className="mb-1 text-[11px] text-dim">Canvas</p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowGrid((s) => !s)}
              className={showGrid ? btnActive : btn}
            >
              Grid
            </button>
            <button onClick={() => setGrid(new Uint8Array(GRID_COLS * GRID_ROWS))} className={btn}>
              Clear walls
            </button>
            <button onClick={() => setRemoved([])} className={btn}>
              Show all
            </button>
          </div>
        </div>
      </div>
      <p className="mb-3 text-xs text-dim">{toolHint}</p>

      {/* Gap-to-paddle slider, in block heights */}
      <label className="mb-3 flex items-center gap-2 text-xs text-dim">
        Gap to paddle
        <input
          type="range"
          min={MIN_GAP_BLOCKS}
          max={MAX_GAP_BLOCKS}
          step={1}
          value={gapBlocks}
          onChange={(e) => setGapBlocks(Number(e.target.value))}
          className="flex-1 accent-phosphor"
        />
        <span className="w-20 text-right font-mono text-bone">
          {gapBlocks} blocks
        </span>
      </label>

      {/* Drawing canvas — THIS is where tools paint (Preview below is read-only) */}
      <h3 className="mt-1 text-sm font-bold text-bone">
        Editor{" "}
        <span className="font-normal text-dim">
          — paint here with the tools above
        </span>
      </h3>
      <div className="mt-2 overflow-hidden rounded-lg border border-line">
        <canvas
          ref={editRef}
          width={WORLD_W}
          height={WORLD_H}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={endStroke}
          onContextMenu={(e) => e.preventDefault()}
          className={`block w-full ${tool === "hide" || tool === "show" ? "cursor-pointer" : "cursor-crosshair"}`}
          style={{ touchAction: "none" }}
        />
      </div>

      {/* Preview window */}
      <h3 className="mt-5 text-sm font-bold text-bone">
        Preview{" "}
        <span className="font-normal text-dim">
          — {wallCells} wall cells · {bricks.length} blocks · {removed.length}{" "}
          hidden · {gapBlocks}-block gap to paddle
        </span>
      </h3>
      <div className="mt-2 overflow-hidden rounded-lg border border-line">
        <canvas
          ref={prevRef}
          width={WORLD_W}
          height={WORLD_H}
          className="block w-full"
        />
      </div>
      {bricks.length === 0 && (
        <p className="mt-2 text-xs text-ambercab">
          Walls cover every block slot — erase some cells or the level clears
          the instant you launch.
        </p>
      )}

      {/* Name + actions */}
      <div className="mt-4 flex flex-col gap-2">
        <label className="text-xs text-dim">
          Level name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Untitled custom level"
            maxLength={60}
            className="mt-1 block w-full rounded border border-line bg-panel px-2 py-1 text-sm text-bone placeholder:text-dim/60 focus:border-phosphor focus:outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => onSave(buildDef())}
            className="rounded border border-phosphor px-4 py-2 text-sm font-bold text-phosphor hover:bg-phosphor hover:text-cabinet"
          >
            {initial ? "Save changes" : "Save level"}
          </button>
          <button
            onClick={() => onPlay(buildDef())}
            className="rounded border border-line px-4 py-2 text-sm text-dim hover:text-bone"
          >
            Playtest
          </button>
          <button
            onClick={onCancel}
            className="rounded border border-line px-4 py-2 text-sm text-dim hover:text-bone"
          >
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
