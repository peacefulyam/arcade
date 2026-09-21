// ─────────────────────────────────────────────────────────────────────────────
// breakout/renderer.ts — the PRESENTATION. Pixi drawing, zero game logic.
//
// SEPARATION OF CONCERNS, the most important idea in this file:
//   engine.ts decides WHERE everything is (positions, alive/dead).
//   THIS file decides how it LOOKS (shapes, colors, scaling).
// The engine never imports Pixi; the renderer never updates physics. Either
// side can be rewritten without touching the other.
//
// PIXI CONCEPTS used here:
//   Stage      — the root Container; everything visible hangs off it.
//   Container  — an invisible grouping node with position/scale (we use one
//                called `world` so the whole playfield scales as a unit).
//   Graphics   — a drawable shape. Expensive to RE-draw, cheap to MOVE: so we
//                draw each entity ONCE and afterwards only set `.position` and
//                `.visible`. Per-frame redraws would trash performance.
//   VIRTUAL RESOLUTION — the engine thinks in a fixed 480×600 world. The real
//                canvas can be any size; each frame we scale `world` so the
//                logical field fits exactly (letterboxed if aspects differ).
// ─────────────────────────────────────────────────────────────────────────────
import { Container, Graphics } from "pixi.js";
import type { Application } from "pixi.js";
import type {
  BreakoutConfig,
  BreakoutState,
  BrickState,
  WallRect,
} from "./types";

/** Darken a hex color toward black by `t` (0 = same, 1 = black). Used to show
 *  a tough brick's damage: full color at full hp, dimmer as hp drops. */
function shade(color: number, t: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const f = 1 - t;
  return ((r * f) | 0) * 0x10000 + ((g * f) | 0) * 0x100 + ((b * f) | 0);
}

export class BreakoutRenderer {
  private world = new Container();
  private paddleG = new Graphics();
  private ballG = new Graphics();
  private brickLayer = new Container();
  /** Static custom-level walls. Empty for built-in levels — see rebuildWalls. */
  private wallLayer = new Container();
  /** Brick id → its Graphics, so per-frame sync is a Map lookup, no search. */
  private brickG = new Map<number, Graphics>();

  constructor(
    private app: Application,
    private config: BreakoutConfig,
  ) {
    const { worldW, worldH } = config;

    // Back panel: one static rounded rect covering the logical field.
    const bg = new Graphics();
    bg.roundRect(0, 0, worldW, worldH, 10).fill(0x17171d);
    bg.stroke({ width: 2, color: 0x2a2a33 });
    this.world.addChild(bg);

    // Custom-level walls sit right above the back panel (below everything
    // dynamic): static geometry, drawn once per level, never per frame.
    this.world.addChild(this.wallLayer);

    // Paddle: drawn ONCE centered on its own origin (−w/2…w/2), so per-frame
    // we just do `paddleG.position.set(paddle.x, paddle.y + h/2)`.
    this.paddleG
      .roundRect(
        -config.paddleW / 2,
        -config.paddleH / 2,
        config.paddleW,
        config.paddleH,
        6,
      )
      .fill(0xece7db);
    this.world.addChild(this.paddleG);

    // Ball: a circle around its origin; per-frame we set its position.
    this.ballG.circle(0, 0, config.ballRadius).fill(0x9ee86e);
    this.world.addChild(this.ballG);

    this.world.addChild(this.brickLayer);
    app.stage.addChild(this.world);
  }

  /**
   * (Re)build brick Graphics from state — called on mount and on restart,
   * NOT every frame. Each brick is positioned by its top-left (Pixi default
   * for rects), matching the engine's `x/y` convention exactly.
   */
  rebuildBricks(bricks: BrickState[]): void {
    this.brickLayer.removeChildren();
    this.brickG.clear();
    for (const brick of bricks) {
      const g = new Graphics();
      g.roundRect(0, 0, brick.w, brick.h, 4).fill(brick.color);
      g.position.set(brick.x, brick.y);
      g.visible = brick.alive;
      this.brickLayer.addChild(g);
      this.brickG.set(brick.id, g);
    }
  }

  /**
   * (Re)build wall Graphics from merged WallRects — called on mount and on
   * restart, NOT every frame. Walls are flat slate bars, visually distinct
   * from the bright bricks: geometry you bounce off, not targets you break.
   */
  rebuildWalls(walls: WallRect[]): void {
    this.wallLayer.removeChildren();
    for (const w of walls) {
      const g = new Graphics();
      g.rect(w.x, w.y, w.w, w.h).fill(0x5b6b8c);
      this.wallLayer.addChild(g);
    }
  }

  /**
   * Per-frame sync: scale the world to the canvas, then mirror engine state
   * into display objects. Called 60×/sec — no allocations, no redraws, just
   * position/visibility writes plus one tint update per damaged brick.
   */
  sync(state: BreakoutState): void {
    const { worldW, worldH } = this.config;

    // Fit the logical world into the real canvas (uniform scale + centering).
    const s = Math.min(
      this.app.screen.width / worldW,
      this.app.screen.height / worldH,
    );
    this.world.scale.set(s);
    this.world.position.set(
      (this.app.screen.width - worldW * s) / 2,
      (this.app.screen.height - worldH * s) / 2,
    );

    this.paddleG.position.set(
      state.paddle.x,
      state.paddle.y + state.paddle.h / 2,
    );
    this.ballG.position.set(state.ball.pos.x, state.ball.pos.y);

    for (const brick of state.bricks) {
      const g = this.brickG.get(brick.id);
      if (!g) continue;
      g.visible = brick.alive;
      if (brick.alive && brick.hp < brick.maxHp) {
        // Damaged tough brick: re-tint toward dark. `clear()` + redraw is
        // fine here — it only happens on the exact frame a hit lands, and
        // `sync` early-outs for full-hp bricks. (Cheaper alternative for a
        // future polish pass: pre-bake one Graphics per damage stage.)
        const damage = 1 - brick.hp / brick.maxHp; // 0…1
        g.clear().roundRect(0, 0, brick.w, brick.h, 4).fill(shade(brick.color, damage * 0.55));
      }
    }
  }

  /** Convert a horizontal client pixel (mouse/touch) into world coordinates. */
  toWorldX(clientX: number, canvas: HTMLCanvasElement): number {
    const rect = canvas.getBoundingClientRect();
    return ((clientX - rect.left) / rect.width) * this.config.worldW;
  }

  /** Tear down everything this renderer added to the stage. */
  destroy(): void {
    this.app.stage.removeChild(this.world);
    this.world.destroy({ children: true });
    this.brickG.clear();
  }
}
