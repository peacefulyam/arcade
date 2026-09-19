// ─────────────────────────────────────────────────────────────────────────────
// breakout/levels.ts — levels are DATA (ASCII maps), not code.
//
// To design a new level you never touch the engine: append a `LevelDef` to
// `LEVELS` below. Each string is one row, each character one cell:
//
//   "."  empty (a gap in the wall)
//   "1"  normal brick, 1 hit  (amber)
//   "2"  normal brick, 1 hit  (green)
//   "3"  normal brick, 1 hit  (bone white)
//   "4"  TOUGH brick,  2 hits (rust red — flashes/darkens after first hit)
//
// Keep every row the SAME length; it must equal config.brickCols (8). The
// builder throws a loud error otherwise — a level typo should fail fast at
// load, not render a lopsided wall.
//
// Future ideas this layout already supports: wider chars for power-up bricks,
// per-level `ballSpeed` multipliers, multi-wave levels (a LevelDef per wave).
// ─────────────────────────────────────────────────────────────────────────────
import type { BrickState, BreakoutConfig, LevelDef } from "./types";

/** Character → durability + color. Edit the palette here; maps stay clean. */
const TILE: Record<string, { hp: number; color: number }> = {
  "1": { hp: 1, color: 0xf0b429 }, // amber
  "2": { hp: 1, color: 0x9ee86e }, // phosphor green
  "3": { hp: 1, color: 0xece7db }, // bone
  "4": { hp: 2, color: 0xe4655a }, // rust — takes two hits
};

export const LEVELS: LevelDef[] = [
  {
    name: "First contact",
    blurb: "A polite wall. The rust-red row hits back twice.",
    pattern: [
      "44444444",
      "22222222",
      "11111111",
      "33333333",
      "11111111",
    ],
  },
  // ── Level 2 stub: uncomment + design when you're ready for progression. ──
  // {
  //   name: "Hollow core",
  //   pattern: [
  //     "11111111",
  //     "1......1",
  //     "4.3333.4",
  //     "1......1",
  //     "22222222",
  //   ],
  // },
];

/**
 * Lay a level's ASCII map out into positioned `BrickState`s.
 * Brick width is DERIVED (fills the space between the side margins), so the
 * wall always spans the field exactly no matter the column count.
 */
export function buildBricks(
  level: LevelDef,
  config: BreakoutConfig,
): BrickState[] {
  const { brickCols, brickSide, brickGap, brickTop, brickH, worldW } = config;

  for (const [i, row] of level.pattern.entries()) {
    if (row.length !== brickCols) {
      throw new Error(
        `Level "${level.name}" row ${i} is ${row.length} cells wide, ` +
          `expected ${brickCols}. Every row must match brickCols.`,
      );
    }
  }

  const totalGap = brickGap * (brickCols - 1);
  const brickW = (worldW - brickSide * 2 - totalGap) / brickCols;

  const bricks: BrickState[] = [];
  let id = 0;
  level.pattern.forEach((rowStr, row) => {
    [...rowStr].forEach((ch, col) => {
      if (ch === ".") return; // gap — no brick here
      const tile = TILE[ch];
      if (!tile) {
        throw new Error(
          `Level "${level.name}" row ${row} col ${col}: unknown tile "${ch}". ` +
            `Valid tiles: ${Object.keys(TILE).join(", ")}, .`,
        );
      }
      bricks.push({
        id: id++,
        col,
        row,
        x: brickSide + col * (brickW + brickGap),
        y: brickTop + row * (brickH + brickGap),
        w: brickW,
        h: brickH,
        hp: tile.hp,
        maxHp: tile.hp,
        color: tile.color,
        alive: true,
      });
    });
  });
  return bricks;
}
