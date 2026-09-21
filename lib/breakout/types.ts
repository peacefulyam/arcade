// ─────────────────────────────────────────────────────────────────────────────
// breakout/types.ts — the shared vocabulary of the whole Breakout feature.
//
// This file intentionally has ZERO imports and ZERO runtime code: it only
// declares types. That keeps it safe for anything to import — the pure
// simulation (engine.ts), the Pixi drawing code (renderer.ts), the React UI,
// and any future code (settings screens, difficulty pickers, level editors,
// high-score tables) — without creating import cycles.
//
// HOW TO EXTEND (the roadmap the rest of the code is shaped around):
//   Settings       → build a `BreakoutConfig` with different numbers.
//   Difficulty     → pick a preset from config.ts (`withDifficulty`).
//   More levels    → append to `LEVELS` in levels.ts (this file's `LevelDef`).
//   High scores    → listen to `EngineEvents.onWin / onGameOver` and persist.
// ─────────────────────────────────────────────────────────────────────────────

/** A 2D point or velocity. Pixi and the engine both use "y grows downward". */
export interface Vec2 {
  x: number;
  y: number;
}

/**
 * The game is a tiny STATE MACHINE — it is always in exactly one phase:
 *   "aim"      Ball is glued to the paddle. Waiting for launch (Space/click).
 *   "playing"  Ball is live. Paddle, walls, bricks all interact.
 *   "gameover" No lives left. Overlay + restart button take over.
 *   "cleared"  Every brick destroyed. Overlay + play-again take over.
 *
 * Future pause support wants a separate `paused: boolean` flag rather than a
 * new phase, so pause can overlay ANY phase without destroying it.
 */
export type GamePhase = "aim" | "playing" | "gameover" | "cleared";

/** Difficulty is declared here but only *consumed* later — see config.ts. */
export type DifficultyId = "easy" | "normal" | "hard";

/**
 * One brick. Bricks are AXIS-ALIGNED rectangles ("AABB" — sides parallel to
 * the screen edges), which makes collision math cheap (see engine.ts).
 * `hp` allows multi-hit bricks: each hit loses 1 hp, it dies at 0.
 */
export interface BrickState {
  id: number;
  col: number;
  row: number;
  x: number; // left edge, in world pixels
  y: number; // top edge, in world pixels
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  /** Pixi hex color, e.g. 0xf0b429. Damaged bricks darken (see renderer). */
  color: number;
  alive: boolean;
}

export interface PaddleState {
  x: number; // CENTER x — steering math is symmetric around the center
  y: number; // TOP edge y (paddle never moves vertically)
  w: number;
  h: number;
}

export interface BallState {
  pos: Vec2;
  vel: Vec2; // pixels per SECOND (frame-rate independent — see engine tick)
  radius: number;
}

/**
 * The full simulation state. ONE object, mutated in place by the engine,
 * owned by the game loop. React does NOT hold this (60fps setState would
 * melt); React only mirrors the tiny HUD slice { score, lives, phase }.
 */
export interface BreakoutState {
  phase: GamePhase;
  score: number;
  lives: number;
  levelIndex: number;
  paddle: PaddleState;
  ball: BallState;
  bricks: BrickState[];
  /** Custom-mode wall colliders. Empty for built-in levels. */
  walls: WallRect[];
  /** Seconds since this attempt started. Useful for timed scoring later. */
  time: number;
}

/**
 * Every tunable number lives here — NOTHING gameplay-related is hardcoded in
 * the engine or renderer. A future settings screen just builds one of these
 * (e.g. from sliders) and hands it to `createInitialState` / `updateGame`.
 */
export interface BreakoutConfig {
  /** Logical playfield size. The renderer scales this to the real canvas. */
  worldW: number;
  worldH: number;

  paddleW: number;
  paddleH: number;
  /** Vertical center-line of the paddle band (ball dies below worldH). */
  paddleY: number;
  /** Max paddle speed, px/sec. Pointer moves are clamped to 1.6× this. */
  paddleSpeed: number;

  ballRadius: number;
  /** Constant ball speed — classic Breakout never accelerates the ball; the
   *  paddle only redirects it. (A future "speed-up per brick" mode would
   *  scale `vel` here.) */
  ballSpeed: number;
  /** Max bounce angle off the paddle, measured FROM VERTICAL in radians.
   *  Hitting the paddle edge steers the ball; hitting center goes straight. */
  maxBounceAngle: number;

  brickRows: number;
  brickCols: number;
  brickH: number;
  brickGap: number;
  /** Empty margin above the top row and on both sides. */
  brickTop: number;
  brickSide: number;

  pointsPerBrick: number;
  lives: number;
}

/**
 * A level is DATA, not code: a name plus an ASCII map. Each character is one
 * brick cell; the legend lives in levels.ts. To design level 2, just add
 * another `{ name, pattern }` — no engine changes needed.
 */
export interface LevelDef {
  name: string;
  pattern: string[];
  blurb?: string;
}

/**
 * A custom-level wall: an AXIS-ALIGNED solid rect the ball bounces off.
 * The editor paints wall CELLS on a grid; custom.ts merges runs of cells
 * into these rects so the ball meets clean faces instead of per-cell seams.
 * Walls are indestructible and worth no points — only `bricks` clear a level.
 */
export interface WallRect {
  x: number; // left edge, in world pixels
  y: number; // top edge, in world pixels
  w: number;
  h: number;
}

/**
 * A player-designed level, persisted in localStorage (see custom.ts).
 * `rows` is GRID_ROWS strings of GRID_COLS "0"/"1" chars ("1" = solid wall).
 * Bricks are auto-filled around the walls at load time, so the def stores
 * only the walls plus two OPTIONAL refinements (absent = defaults, which is
 * also how older saves keep loading):
 *   blockGap — gap between the lowest blocks and the paddle, in BLOCK
 *     heights (the editor slider). The field always starts at the built-in
 *     brickTop; the slider moves where it ENDS.
 *   removed — erased-block cutout rects (world px); any fill brick whose
 *     CENTER falls inside one is dropped. Stored as rects (not fill-grid
 *     cells) so erasures stay put when the slider reshapes the fill grid.
 *   fillTop — LEGACY pre-slider field, ignored by the filler (kept in the
 *     type so old saves still parse; their block start resets to default).
 */
export interface CustomLevelDef {
  id: string;
  name: string;
  rows: string[];
  createdAt: number;
  updatedAt: number;
  blockGap?: number;
  fillTop?: number;
  removed?: WallRect[];
}

/**
 * Which level the game boots: a built-in ASCII level by index, or a custom
 * wall-grid def. The React shell keys the game component on this so a switch
 * remounts with a fresh sim (no mid-run state surgery).
 */
export type LevelSource =
  | { kind: "builtin"; index: number }
  | { kind: "custom"; level: CustomLevelDef };

/**
 * Snapshot of the controls for ONE frame. The React component fills this in
 * from keyboard + pointer listeners; the engine only READS it. Keeping input
 * as plain data (instead of letting the engine touch the DOM) is what makes
 * engine.ts unit-testable with zero browser.
 */
export interface InputState {
  left: boolean;
  right: boolean;
  /** Desired paddle x in world pixels, or null when the pointer is idle. */
  pointerX: number | null;
}

/**
 * Side-effect hooks the engine FIRES but never implements: sound effects,
 * HUD sync, and — later — high-score persistence all plug in here. The engine
 * stays pure logic; the React layer passes callbacks that hit WebAudio /
 * localStorage / whatever. If you only want a silent headless sim (tests),
 * pass nothing.
 */
export interface EngineEvents {
  onLaunch?: () => void;
  onWallBounce?: () => void;
  onPaddleBounce?: () => void;
  onBrickHit?: (brick: BrickState) => void;
  onBrickDestroyed?: (brick: BrickState) => void;
  onLifeLost?: (livesLeft: number) => void;
  /** A future high-score table subscribes here (and to onGameOver). */
  onWin?: (score: number) => void;
  onGameOver?: (score: number) => void;
}
