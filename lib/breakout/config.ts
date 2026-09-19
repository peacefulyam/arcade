// ─────────────────────────────────────────────────────────────────────────────
// breakout/config.ts — every tunable number in one place.
//
// WHY THIS FILE EXISTS: game "feel" is found by tweaking numbers, not by
// rewriting logic. Centralizing them means a future settings screen can show
// a slider per field, and difficulty modes become one-line preset lookups.
//
// Units: pixels and pixels/second, in the LOGICAL world (480×600). The real
// canvas may be bigger/smaller; renderer.ts scales world → screen, so gameplay
// never cares about the device. Speeds are per-second so motion is identical
// at 60Hz, 120Hz, or a laggy 30Hz (the engine multiplies by `dt` each tick).
// ─────────────────────────────────────────────────────────────────────────────
import type { BreakoutConfig, DifficultyId } from "./types";

/** The shipped tuning. Everything downstream takes this as a default arg. */
export const DEFAULT_CONFIG: BreakoutConfig = {
  worldW: 480,
  worldH: 600,

  paddleW: 84,
  paddleH: 12,
  paddleY: 560, // 40px above the bottom edge — room to see the ball coming
  paddleSpeed: 440, // crosses the 480px field in ~1.1s

  ballRadius: 7,
  ballSpeed: 360, // crosses the field height in ~1.7s: brisk but readable
  maxBounceAngle: (65 * Math.PI) / 180, // edge hits leave at 65° from vertical

  brickRows: 5,
  brickCols: 8,
  brickH: 22,
  brickGap: 6,
  brickTop: 76, // leaves a "sky" gap so the ball visibly travels up first
  brickSide: 24,

  pointsPerBrick: 10,
  lives: 3,
};

/**
 * FUTURE difficulty screen, ready to wire up: each preset is a PARTIAL config
 * spread over DEFAULT_CONFIG (see `withDifficulty`). Only the fields that
 * matter per difficulty are overridden — everything else stays canonical.
 *
 * Game-design notes for when you build the picker:
 *   easy   — wider paddle + slower ball: rallies last, mistakes forgive.
 *   normal — the shipped tuning above.
 *   hard   — narrower paddle + faster ball: positioning matters.
 */
export const DIFFICULTY_PRESETS: Record<DifficultyId, Partial<BreakoutConfig>> = {
  easy: { paddleW: 110, ballSpeed: 290 },
  normal: {},
  hard: { paddleW: 64, ballSpeed: 445 },
};

/** Merge a preset over a base config. The future difficulty UI calls this. */
export function withDifficulty(
  base: BreakoutConfig,
  id: DifficultyId,
): BreakoutConfig {
  return { ...base, ...DIFFICULTY_PRESETS[id] };
}

/** Largest single `dt` the engine will accept (seconds). Above this — e.g. a
 *  tab that was backgrounded for a minute — the tick is clamped so the ball
 *  can't teleport through walls. The leftover time is simply dropped. */
export const MAX_DT = 1 / 30;
