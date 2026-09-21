// ─────────────────────────────────────────────────────────────────────────────
// breakout/engine.ts — the SIMULATION. Pure logic, zero Pixi, zero DOM.
//
// This is the file to READ if you want to learn how the game works. The big
// ideas (each marked below):
//
//   1. FIXED ROLES: state is one mutable object owned by the game loop.
//   2. FRAME-RATE INDEPENDENCE: every motion multiplies by `dt` (seconds
//      since last frame), so 30Hz and 120Hz screens play identically.
//   3. SUBSTEPS: fast balls move in small hops so they can't tunnel through
//      thin bricks between frames.
//   4. CIRCLE-vs-AABB collision: bricks/paddle are rectangles; the ball is a
//      circle. Closest-point test + min-penetration bounce axis.
//   5. PADDLE STEERING: where the ball lands on the paddle sets its angle.
//   6. STATE MACHINE: aim → playing → (aim …) → gameover | cleared.
//
// Because this module never touches rendering or input hardware, you can
// drive it from a unit test, a bot, or a level-preview tool: just build an
// `InputState` by hand and call `updateGame` in a loop.
// ─────────────────────────────────────────────────────────────────────────────
import { MAX_DT } from "./config";
import { buildBricks, LEVELS } from "./levels";
import type {
  BallState,
  BreakoutConfig,
  BreakoutState,
  BrickState,
  EngineEvents,
  InputState,
  WallRect,
} from "./types";

/** Clamp helper used everywhere bounds matter (paddle range, hit offset…). */
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

// ── Setup ────────────────────────────────────────────────────────────────────

/**
 * Fresh game: paddle centered, ball glued to the paddle, bricks built from
 * `LEVELS[levelIndex]`, full lives, score zero, waiting in "aim".
 */
export function createInitialState(
  config: BreakoutConfig,
  levelIndex = 0,
): BreakoutState {
  const level = LEVELS[levelIndex % LEVELS.length];
  const paddle = {
    x: config.worldW / 2,
    y: config.paddleY,
    w: config.paddleW,
    h: config.paddleH,
  };
  const ball: BallState = {
    pos: { x: paddle.x, y: paddle.y - config.ballRadius - 1 },
    vel: { x: 0, y: 0 }, // stationary until launch — see launchBall
    radius: config.ballRadius,
  };
  return {
    phase: "aim",
    score: 0,
    lives: config.lives,
    levelIndex,
    paddle,
    ball,
    bricks: buildBricks(level, config),
    walls: [], // built-in levels have no walls; custom.ts fills these in
    time: 0,
  };
}

/** Park the ball just above the paddle (used at start + after losing a life). */
function stickBallToPaddle(state: BreakoutState): void {
  state.ball.pos.x = state.paddle.x;
  state.ball.pos.y = state.paddle.y - state.ball.radius - 1;
  state.ball.vel.x = 0;
  state.ball.vel.y = 0;
}

/**
 * Fire the ball upward with a slight random tilt (±15°) so repeated launches
 * don't play identically. Called on Space / click / tap while aiming.
 */
export function launchBall(
  state: BreakoutState,
  config: BreakoutConfig,
  events: EngineEvents = {},
): void {
  if (state.phase !== "aim") return;
  const tilt = (Math.random() * 2 - 1) * 0.26; // radians, ±~15°
  state.ball.vel.x = Math.sin(tilt) * config.ballSpeed;
  state.ball.vel.y = -Math.cos(tilt) * config.ballSpeed; // −y = UP (y grows down)
  state.phase = "playing";
  events.onLaunch?.();
}

// ── Per-frame tick ───────────────────────────────────────────────────────────

/**
 * Advance the world by one frame. `rawDt` is wall-clock seconds since the last
 * frame; it gets CLAMPED (see MAX_DT) so backgrounding the tab can't fling
 * the ball through a wall on return — the excess time is dropped, the game
 * just appears to pause briefly.
 */
export function updateGame(
  state: BreakoutState,
  input: InputState,
  rawDt: number,
  config: BreakoutConfig,
  events: EngineEvents = {},
): void {
  const dt = Math.min(rawDt, MAX_DT);
  if (dt <= 0) return;
  if (state.phase === "gameover" || state.phase === "cleared") return;

  movePaddle(state, input, dt, config);

  if (state.phase === "aim") {
    // Ball rides the paddle until launch — lets the player position the shot.
    stickBallToPaddle(state);
    state.time += dt;
    return;
  }

  // — Substeps: split fast motion into hops ≤ half a ball-radius each. ——
  // Without this ("tunneling"), a 360px/s ball at a 30Hz hitch jumps 12px in
  // one frame — straight through a 22px brick's edge without ever overlapping
  // it. More, smaller steps cost a little CPU and buy a lot of correctness.
  const speed = Math.hypot(state.ball.vel.x, state.ball.vel.y);
  const steps = Math.min(
    8,
    Math.max(1, Math.ceil((speed * dt) / (state.ball.radius * 0.5))),
  );
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    stepBall(state, h, config, events);
    if (state.phase !== "playing") break; // life lost / won mid-frame: stop
  }
  state.time += dt;
}

/**
 * Paddle control, two schemes, pointer wins when present:
 *  - KEYBOARD: constant-velocity drive (left/right arrows or A/D).
 *  - POINTER (mouse/touch): glide TOWARD the pointer, speed-limited so it
 *    still feels physical instead of teleporting.
 */
function movePaddle(
  state: BreakoutState,
  input: InputState,
  dt: number,
  config: BreakoutConfig,
): void {
  const half = state.paddle.w / 2;
  const lo = half;
  const hi = config.worldW - half;

  if (input.pointerX !== null) {
    const target = clamp(input.pointerX, lo, hi);
    const maxStep = config.paddleSpeed * 1.6 * dt;
    const dx = target - state.paddle.x;
    state.paddle.x += clamp(dx, -maxStep, maxStep);
  } else {
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    state.paddle.x = clamp(
      state.paddle.x + dir * config.paddleSpeed * dt,
      lo,
      hi,
    );
  }
}

/** One substep: integrate the ball, then collide walls → paddle → bricks. */
function stepBall(
  state: BreakoutState,
  dt: number,
  config: BreakoutConfig,
  events: EngineEvents,
): void {
  const b = state.ball;
  const px0 = b.pos.x;
  const py0 = b.pos.y;
  b.pos.x += b.vel.x * dt;
  b.pos.y += b.vel.y * dt;

  collideWalls(state, config, events);
  if (state.phase !== "playing") return; // fell out the bottom
  collidePaddle(state, config, events);
  collideBricks(state, config, events);
  // Level walls run LAST (see collideLevelWalls for why the order matters).
  collideLevelWalls(state, px0, py0, events);
}

// ── Collisions ───────────────────────────────────────────────────────────────

/**
 * Three closed walls bounce; the floor KILLS. After bouncing we also push the
 * ball back inside the wall — otherwise it stays embedded and re-collides
 * every substep (classic "sticky wall" bug).
 */
function collideWalls(
  state: BreakoutState,
  config: BreakoutConfig,
  events: EngineEvents,
): void {
  const b = state.ball;
  const r = b.radius;

  if (b.pos.x < r) {
    b.pos.x = r;
    b.vel.x = Math.abs(b.vel.x);
    events.onWallBounce?.();
  } else if (b.pos.x > config.worldW - r) {
    b.pos.x = config.worldW - r;
    b.vel.x = -Math.abs(b.vel.x);
    events.onWallBounce?.();
  }
  if (b.pos.y < r) {
    b.pos.y = r;
    b.vel.y = Math.abs(b.vel.y);
    events.onWallBounce?.();
  }

  if (b.pos.y - r > config.worldH) {
    // Fell past the floor: lose a life, keep the surviving wall of bricks
    // (classic rules), re-aim — or end the run.
    state.lives -= 1;
    events.onLifeLost?.(state.lives);
    if (state.lives <= 0) {
      state.phase = "gameover";
      state.lives = 0;
      events.onGameOver?.(state.score);
    } else {
      state.phase = "aim";
      state.paddle.x = config.worldW / 2;
      stickBallToPaddle(state);
    }
  }
}

/**
 * CUSTOM-LEVEL WALLS — SWEPT segment-vs-rect collision, not discrete overlap.
 *
 * WHY SWEPT: brick hits resolve penetration by shoving the ball up to ~19px
 * in one shot. When a wall and a brick are touched in the same substep, that
 * shove can teleport the ball clean PAST a 4.8px wall — the next substep sees
 * no overlap and the ball "goes through the wall". Testing the whole substep
 * PATH (pre-move position → post-brick position, which is why this pass runs
 * LAST) against every wall catches the crossing even when a brick shove
 * caused it, because the path itself still crosses the wall.
 *
 * One wall max per substep (the earliest contact): contact sits exactly one
 * radius off the wall so no positional push is needed, velocity flips into
 * the outward hemisphere (speed preserved — single-axis flip), and remaining
 * motion resumes next substep. No score, no damage: walls just redirect.
 */
function collideLevelWalls(
  state: BreakoutState,
  x0: number,
  y0: number,
  events: EngineEvents,
): void {
  const b = state.ball;
  const dx = b.pos.x - x0;
  const dy = b.pos.y - y0;

  if (dx === 0 && dy === 0) {
    // Motionless substep: just push out of any embedding (grazes stay
    // silent — see pushOutOfWall).
    for (const w of state.walls) pushOutOfWall(state, w, events);
    return;
  }

  // Earliest swept contact: segment vs rect expanded by the ball radius
  // (slab method). t in [0,1]; the LAST-entered slab owns the contact normal.
  let bestT = Infinity;
  let bestNX = 0;
  let bestNY = 0;
  let embedded: WallRect | null = null;
  for (const w of state.walls) {
    const r = b.radius;
    const minX = w.x - r;
    const maxX = w.x + w.w + r;
    const minY = w.y - r;
    const maxY = w.y + w.h + r;
    let tNearX: number, tFarX: number, nx: number;
    if (dx === 0) {
      if (x0 < minX || x0 > maxX) continue;
      tNearX = -Infinity;
      tFarX = Infinity;
      nx = 0;
    } else if (dx > 0) {
      tNearX = (minX - x0) / dx;
      tFarX = (maxX - x0) / dx;
      nx = -1;
    } else {
      tNearX = (maxX - x0) / dx;
      tFarX = (minX - x0) / dx;
      nx = 1;
    }
    let tNearY: number, tFarY: number, ny: number;
    if (dy === 0) {
      if (y0 < minY || y0 > maxY) continue;
      tNearY = -Infinity;
      tFarY = Infinity;
      ny = 0;
    } else if (dy > 0) {
      tNearY = (minY - y0) / dy;
      tFarY = (maxY - y0) / dy;
      ny = -1;
    } else {
      tNearY = (maxY - y0) / dy;
      tFarY = (minY - y0) / dy;
      ny = 1;
    }
    const tEnter = Math.max(tNearX, tNearY);
    const tExit = Math.min(tFarX, tFarY);
    if (tEnter > tExit || tExit < 0 || tEnter > 1) continue; // miss
    if (tEnter < 0) {
      embedded = w; // path starts inside: discrete push-out below
      break;
    }
    if (tEnter < bestT) {
      bestT = tEnter;
      // Exact corner ties follow the faster axis (a diagonal corner graze
      // keeps the motion's dominant direction).
      if (tNearX > tNearY) {
        bestNX = nx;
        bestNY = 0;
      } else if (tNearY > tNearX) {
        bestNX = 0;
        bestNY = ny;
      } else if (Math.abs(dx) >= Math.abs(dy)) {
        bestNX = nx;
        bestNY = 0;
      } else {
        bestNX = 0;
        bestNY = ny;
      }
    }
  }

  if (embedded) {
    pushOutOfWall(state, embedded, events);
    return;
  }
  if (bestT === Infinity || (bestNX === 0 && bestNY === 0)) return; // miss
  b.pos.x = x0 + dx * bestT;
  b.pos.y = y0 + dy * bestT;
  if (bestNX !== 0) {
    b.vel.x = bestNX > 0 ? Math.abs(b.vel.x) : -Math.abs(b.vel.x);
  } else {
    b.vel.y = bestNY > 0 ? Math.abs(b.vel.y) : -Math.abs(b.vel.y);
  }
  events.onWallBounce?.();
}

/**
 * Discrete push-out for a ball starting a substep EMBEDDED in a wall (e.g. a
 * brick shove wedged it in): out along the shallower axis, velocity into the
 * outward hemisphere. Grazes (penetration ~0) are ignored WITHOUT an event —
 * a ball sliding along a wall face must not machine-gun the bounce sound.
 */
function pushOutOfWall(
  state: BreakoutState,
  w: WallRect,
  events: EngineEvents,
): void {
  const b = state.ball;
  const centerX = w.x + w.w / 2;
  const centerY = w.y + w.h / 2;
  const penX = w.w / 2 + b.radius - Math.abs(b.pos.x - centerX);
  const penY = w.h / 2 + b.radius - Math.abs(b.pos.y - centerY);
  if (Math.min(penX, penY) <= 1e-9) return; // touching, not embedded
  if (penX < penY) {
    b.vel.x = b.pos.x < centerX ? -Math.abs(b.vel.x) : Math.abs(b.vel.x);
    b.pos.x += b.pos.x < centerX ? -penX : penX;
  } else {
    b.vel.y = b.pos.y < centerY ? -Math.abs(b.vel.y) : Math.abs(b.vel.y);
    b.pos.y += b.pos.y < centerY ? -penY : penY;
  }
  events.onWallBounce?.();
}

/**
 * PADDLE STEERING — the skill shot of Breakout. Only fires while the ball
 * travels DOWNWARD into the paddle band. The bounce angle maps linearly from
 * the contact point: dead center → straight up, edge → maxBounceAngle.
 * Speed is PRESERVED (we renormalize to config.ballSpeed) so rallies never
 * decay into a vertical dribble or accelerate out of control.
 */
function collidePaddle(
  state: BreakoutState,
  config: BreakoutConfig,
  events: EngineEvents,
): void {
  const { paddle: p, ball: b } = state;
  if (b.vel.y <= 0) return; // moving up/level: can't be caught by the paddle

  const halfW = p.w / 2;
  const halfH = p.h / 2;
  const dx = b.pos.x - p.x;
  const dy = b.pos.y - p.y; // paddle y is its TOP edge; center is y + halfH
  const dyFromCenter = dy - halfH;

  const overlapX = halfW + b.radius - Math.abs(dx);
  const overlapY = halfH + b.radius - Math.abs(dyFromCenter);
  if (overlapX <= 0 || overlapY <= 0) return; // no contact

  // Contact! −1 (left edge) … +1 (right edge), clamped for corner grazes.
  const hit = clamp(dx / halfW, -1, 1);
  const angle = hit * config.maxBounceAngle;
  const speed = config.ballSpeed;
  b.vel.x = Math.sin(angle) * speed;
  b.vel.y = -Math.cos(angle) * speed;
  // Lift the ball out so the next substep doesn't see a second "hit".
  b.pos.y = p.y - b.radius - 0.5;
  events.onPaddleBounce?.();
}

/**
 * CIRCLE-vs-AABB, one brick max per substep (break after the first hit so a
 * corner shared by two bricks can't eat both — or double-bounce — at once).
 * Test: clamp the ball center into the rect → closest point → inside the
 * radius = hit. Bounce axis: whichever penetration is shallower wins (hit the
 * flat face you were closest to). hp drops per hit; score only on DESTROY —
 * tough bricks must be "paid for" before they pay out.
 */
function collideBricks(
  state: BreakoutState,
  config: BreakoutConfig,
  events: EngineEvents,
): void {
  const b = state.ball;

  for (const brick of state.bricks) {
    if (!brick.alive) continue;

    // Closest point on the rect to the ball center…
    const cx = clamp(b.pos.x, brick.x, brick.x + brick.w);
    const cy = clamp(b.pos.y, brick.y, brick.y + brick.h);
    const ddx = b.pos.x - cx;
    const ddy = b.pos.y - cy;
    if (ddx * ddx + ddy * ddy > b.radius * b.radius) continue; // miss

    // …hit. Resolve along the shallower penetration axis.
    const centerX = brick.x + brick.w / 2;
    const centerY = brick.y + brick.h / 2;
    const penX = brick.w / 2 + b.radius - Math.abs(b.pos.x - centerX);
    const penY = brick.h / 2 + b.radius - Math.abs(b.pos.y - centerY);
    if (penX < penY) {
      b.vel.x = b.pos.x < centerX ? -Math.abs(b.vel.x) : Math.abs(b.vel.x);
      b.pos.x += b.pos.x < centerX ? -penX : penX;
    } else {
      b.vel.y = b.pos.y < centerY ? -Math.abs(b.vel.y) : Math.abs(b.vel.y);
      b.pos.y += b.pos.y < centerY ? -penY : penY;
    }

    brick.hp -= 1;
    events.onBrickHit?.(brick);
    if (brick.hp <= 0) {
      brick.alive = false;
      state.score += config.pointsPerBrick;
      events.onBrickDestroyed?.(brick);
    }
    break; // one brick per substep — see note above
  }

  if (state.bricks.every((brick) => !brick.alive)) {
    state.phase = "cleared";
    events.onWin?.(state.score);
  }
}

// ── Queries (for HUD + future features) ──────────────────────────────────────

/** Bricks still standing — HUD progress ("12 left") or level-select previews. */
export function aliveBricks(state: BreakoutState): BrickState[] {
  return state.bricks.filter((b) => b.alive);
}

/** Fraction cleared, 0…1 — drives a future progress bar without new logic. */
export function clearFraction(state: BreakoutState): number {
  if (state.bricks.length === 0) return 1;
  return 1 - aliveBricks(state).length / state.bricks.length;
}
