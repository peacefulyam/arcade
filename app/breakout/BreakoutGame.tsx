// ─────────────────────────────────────────────────────────────────────────────
// BreakoutGame.tsx — the WIRING. A React client component that connects:
//     engine.ts (simulation) + renderer.ts (Pixi) + sound.ts (WebAudio)
//     + keyboard/mouse/touch input + the HUD you see around the canvas.
//
// REACT + GAME-LOOP ARCHITECTURE (why it's built this way):
//   • The simulation state lives in a `useRef`, NOT `useState`. The ticker
//     mutates it 60×/sec; putting it in state would re-render React 60×/sec.
//   • React state holds ONLY the slow-moving HUD mirror: score, lives, phase,
//     paused. `setState` fires only when one of those actually CHANGES.
//   • Input listeners write into a ref (`inputRef`). The engine polls that
//     ref each tick ("polling") instead of reacting to events directly — this
//     decouples key-repeat quirks from simulation speed.
//   • All Pixi objects are created in ONE `useEffect` and destroyed in its
//     cleanup. React StrictMode double-mounts in dev, so the effect must be
//     fully idempotent: create → destroy → create must not leak or double-add
//     tickers (guarded with a `cancelled` flag + `app.destroy()`).
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useEffect, useRef, useState } from "react";
import { createGameApp } from "@/lib/pixi";
import { DEFAULT_CONFIG } from "@/lib/breakout/config";
import {
  createInitialState,
  launchBall,
  updateGame,
} from "@/lib/breakout/engine";
import { LEVELS } from "@/lib/breakout/levels";
import { BreakoutRenderer } from "@/lib/breakout/renderer";
import { SoundBank } from "@/lib/breakout/sound";
import type {
  BreakoutState,
  GamePhase,
  InputState,
} from "@/lib/breakout/types";

/** The tiny slice of game state React actually renders (see header). */
interface Hud {
  score: number;
  lives: number;
  phase: GamePhase;
  levelName: string;
}

export default function BreakoutGame() {
  // The canvas's parent div. Pixi's canvas gets mounted INSIDE it.
  const containerRef = useRef<HTMLDivElement>(null);

  // Mutable game-loop ownership (never triggers renders on their own)…
  const stateRef = useRef<BreakoutState | null>(null);
  // Reset handle installed by the boot effect (it owns the renderer): creates
  // a fresh sim state AND rebuilds brick Graphics, so restart needs no reload.
  const resetRef = useRef<(() => void) | null>(null);
  const inputRef = useRef<InputState>({ left: false, right: false, pointerX: null });
  const pausedRef = useRef(false);
  const soundRef = useRef<SoundBank | null>(null);
  if (!soundRef.current) soundRef.current = new SoundBank();

  // …and the small React-rendered mirrors.
  const [hud, setHud] = useState<Hud>({
    score: 0,
    lives: DEFAULT_CONFIG.lives,
    phase: "aim",
    levelName: LEVELS[0].name,
  });
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  // ── Debug overlay (toggled with V) ─────────────────────────────────────
  // Per-tick numbers live in refs — NOT state — so the 60Hz ticker can write
  // them straight into the DOM without re-rendering React (same reason the
  // sim state itself lives in a ref). `showDebug` state only mounts or
  // unmounts the box; the ticker paints into it when present.
  const debugElRef = useRef<HTMLDivElement | null>(null);
  const prevPaddleXRef = useRef<number | null>(null);
  const paddleVelRef = useRef(0);
  const ballDistRef = useRef(0);
  // Last ball departure direction, degrees from straight-up (+ = right).
  // Captured on launch + every bounce (see `events`); null until first launch.
  const lastDepartRef = useRef<number | null>(null);

  // Push one field into its ref AND mirror it to React (for buttons).
  const setPausedBoth = (v: boolean) => {
    pausedRef.current = v;
    setPaused(v);
  };

  // ── Main effect: boot Pixi, wire input, run the loop ──────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false; // StrictMode guard: ignore late async completions
    let app: Awaited<ReturnType<typeof createGameApp>> | null = null;
    let renderer: BreakoutRenderer | null = null;

    const config = DEFAULT_CONFIG;
    const sound = soundRef.current!;
    // `state` is `let` (not const): reset() swaps in a fresh object and the
    // ticker closure reads the CURRENT one via a getter — see below.
    let state = createInitialState(config, 0);
    stateRef.current = state;
    prevPaddleXRef.current = state.paddle.x;

    // Snapshot the ball's post-bounce heading as degrees-from-vertical
    // (up = 0°, right = +). Engine callbacks fire synchronously inside the
    // tick, AFTER velocity is updated — so `state` already holds the new
    // departure vector when these run.
    const recordDeparture = () => {
      const v = state.ball.vel;
      if (v.x === 0 && v.y === 0) return;
      lastDepartRef.current = (Math.atan2(v.x, -v.y) * 180) / Math.PI;
    };

    // Engine events → sound. (A future high-score table hooks onWin/onGameOver
    // right here, next to the sound calls — same pattern, new subscriber.)
    const events = {
      onLaunch: () => {
        sound.launch();
        recordDeparture();
      },
      onWallBounce: () => {
        sound.wall();
        recordDeparture();
      },
      onPaddleBounce: () => {
        sound.paddle();
        recordDeparture();
      },
      onBrickHit: () => {
        sound.brickHit();
        recordDeparture();
      },
      onBrickDestroyed: () => sound.brickDestroyed(),
      onLifeLost: () => sound.lifeLost(),
      onWin: () => sound.win(),
    };

    // Push engine state into React ONLY when the HUD-visible part changes.
    const pushHud = () => {
      setHud((prev) =>
        prev.score === state.score &&
        prev.lives === state.lives &&
        prev.phase === state.phase
          ? prev // identical → React bails out, no re-render
          : {
              score: state.score,
              lives: state.lives,
              phase: state.phase,
              levelName: LEVELS[state.levelIndex % LEVELS.length].name,
            },
      );
    };
    pushHud();

    // ── Input: keyboard ──
    const down = (e: KeyboardEvent) => {
      // Arrows scroll the page by default — suppress that inside the game.
      if (["ArrowLeft", "ArrowRight", " "].includes(e.key)) e.preventDefault();
      if (e.repeat) return; // ignore OS key-repeat; polling reads held state
      switch (e.key) {
        case "ArrowLeft":
        case "a":
        case "A":
          inputRef.current.left = true;
          inputRef.current.pointerX = null; // keys take over from the pointer
          break;
        case "ArrowRight":
        case "d":
        case "D":
          inputRef.current.right = true;
          inputRef.current.pointerX = null;
          break;
        case " ":
        case "Enter":
          launchBall(state, config, events);
          pushHud();
          break;
        case "p":
        case "P":
          setPausedBoth(!pausedRef.current);
          break;
        case "r":
        case "R":
          resetRef.current?.();
          break;
        case "v":
        case "V":
          setShowDebug((s) => !s);
          break;
      }
    };
    const up = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowLeft":
        case "a":
        case "A":
          inputRef.current.left = false;
          break;
        case "ArrowRight":
        case "d":
        case "D":
          inputRef.current.right = false;
          break;
      }
    };

    // ── Input: pointer (mouse + touch unified via Pointer Events) ──
    // Moving steers the paddle; clicking/tapping launches while aiming.
    const onPointerMove = (e: PointerEvent) => {
      if (!renderer || !app) return;
      inputRef.current.pointerX = renderer.toWorldX(e.clientX, app.canvas);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!renderer || !app) return;
      inputRef.current.pointerX = renderer.toWorldX(e.clientX, app.canvas);
      launchBall(state, config, events);
      pushHud();
    };
    // Auto-pause when the tab hides — rAF stops anyway, but this also freezes
    // the HUD clock honestly instead of jumping on return.
    const onVisibility = () => {
      if (document.hidden) setPausedBoth(true);
    };

    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    document.addEventListener("visibilitychange", onVisibility);

    // ── Boot Pixi (async: creates canvas, mounts it, starts the ticker) ──
    (async () => {
      const created = await createGameApp(container, { background: "#101014" });
      if (cancelled) {
        created.destroy(true); // StrictMode unmounted before init finished
        return;
      }
      app = created;
      renderer = new BreakoutRenderer(app, config);
      renderer.rebuildBricks(state.bricks);

      // Restart without reloading: swap in a fresh sim, rebuild brick
      // Graphics to match, unpause. The ticker/closures capture the `state`
      // VARIABLE (declared `let`), so they automatically see the new object.
      resetRef.current = () => {
        state = createInitialState(config, 0);
        stateRef.current = state;
        prevPaddleXRef.current = state.paddle.x;
        paddleVelRef.current = 0;
        ballDistRef.current = 0;
        lastDepartRef.current = null;
        inputRef.current.pointerX = null;
        renderer!.rebuildBricks(state.bricks);
        renderer!.sync(state);
        setPausedBoth(false);
        pushHud();
      };

      const canvas = app.canvas;
      canvas.addEventListener("pointermove", onPointerMove as EventListener);
      canvas.addEventListener("pointerdown", onPointerDown as EventListener);
      // Touch drag shouldn't scroll the page mid-rally.
      canvas.style.touchAction = "none";

      // THE GAME LOOP: Pixi's ticker fires before every repaint (~60Hz),
      // passing elapsed milliseconds. We convert to seconds, skip paused
      // frames, step the sim, mirror to Pixi, and sync the HUD on change.
      app.ticker.add((ticker) => {
        if (pausedRef.current) return;
        const dt = ticker.deltaMS / 1000;
        updateGame(state, inputRef.current, dt, config, events);
        renderer!.sync(state);
        pushHud(); // cheap: setState bails out when nothing changed

        // ── Debug telemetry: track every tick, paint only when visible ──
        // Tracking runs unconditionally so toggling the box mid-rally shows
        // live numbers (no zeroed odometer, no velocity spike); only the DOM
        // write is gated on the box being mounted.
        const prevX = prevPaddleXRef.current ?? state.paddle.x;
        paddleVelRef.current = dt > 0 ? (state.paddle.x - prevX) / dt : 0;
        prevPaddleXRef.current = state.paddle.x;
        ballDistRef.current += Math.hypot(state.ball.vel.x, state.ball.vel.y) * dt;
        const el = debugElRef.current;
        if (el) {
          let bricksLeft = 0;
          for (const b of state.bricks) if (b.alive) bricksLeft++;
          const depart = lastDepartRef.current;
          el.textContent =
            `ball x,y: ${state.ball.pos.x.toFixed(1)}, ${state.ball.pos.y.toFixed(1)}\n` +
            `bricks left: ${bricksLeft}\n` +
            `depart deg: ${depart === null ? "--" : depart.toFixed(1)}\n` +
            `pad x,y: ${state.paddle.x.toFixed(1)}, ${state.paddle.y.toFixed(1)}\n` +
            `pad vel: ${paddleVelRef.current.toFixed(1)} px/s\n` +
            `ball dist: ${ballDistRef.current.toFixed(1)} px`;
        }
      });
      renderer.sync(state);
    })();

    // ── Cleanup: remove EVERYTHING this effect added (listeners, Pixi) ──
    return () => {
      cancelled = true;
      resetRef.current = null;
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      document.removeEventListener("visibilitychange", onVisibility);
      renderer?.destroy();
      renderer = null;
      if (app) {
        app.destroy(true);
        app = null;
      }
      stateRef.current = null;
    };
  }, []);

  // ── UI actions ──
  // Restart via the reset handle the boot effect installed (fresh sim state +
  // rebuilt brick Graphics, no page reload). Null only before Pixi finishes
  // booting — the button can't be visible that early, but guard anyway.
  const restart = () => resetRef.current?.();

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (soundRef.current) soundRef.current.enabled = !next;
  };

  const overlay = hud.phase === "gameover" || hud.phase === "cleared";

  return (
    <div>
      {/* HUD bar: score / lives / level — plain HTML, NOT Pixi text. Keeping
          text in the DOM is crisper, accessible, and cheaper than canvas text. */}
      <div className="mb-3 flex items-center justify-between text-sm">
        <div>
          <span className="text-dim">SCORE </span>
          <span className="font-bold text-phosphor">{hud.score}</span>
        </div>
        <div className="text-dim">
          {hud.levelName} ·{" "}
          <span className="text-bone">
            {"●".repeat(hud.lives)}
            {"○".repeat(Math.max(0, DEFAULT_CONFIG.lives - hud.lives))}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setPausedBoth(!paused)}
            className="rounded border border-line px-2 py-1 text-xs text-dim hover:text-bone"
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={toggleMute}
            className="rounded border border-line px-2 py-1 text-xs text-dim hover:text-bone"
          >
            {muted ? "Unmute" : "Mute"}
          </button>
        </div>
      </div>

      {/* Canvas mount. Aspect matches the logical world (480:600 = 4:5) so the
          renderer's fit-scale is exact, no letterboxing on this layout. */}
      <div className="relative">
        <div
          ref={containerRef}
          className="aspect-[4/5] w-full overflow-hidden rounded-lg border border-line [&>canvas]:block [&>canvas]:h-full [&>canvas]:w-full"
        />
        {overlay && (
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-cabinet/85 text-center">
            <p
              className={`text-2xl font-bold ${hud.phase === "cleared" ? "text-phosphor" : "text-ambercab"}`}
            >
              {hud.phase === "cleared" ? "Wall cleared!" : "Game over"}
            </p>
            <p className="mt-2 text-sm text-dim">Final score: {hud.score}</p>
            <button
              onClick={restart}
              className="mt-5 rounded border border-phosphor px-4 py-2 text-sm font-bold text-phosphor hover:bg-phosphor hover:text-cabinet"
            >
              Play again (R)
            </button>
          </div>
        )}
        {!overlay && hud.phase === "aim" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-24 text-center text-sm text-dim">
            Press Space or click/tap to launch
          </div>
        )}
        {paused && !overlay && (
          <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-cabinet/70">
            <p className="text-lg font-bold text-bone">Paused — P to resume</p>
          </div>
        )}
        {/* Debug readout: monospace, semi-transparent, top-right. Content is
            painted every tick via debugElRef (see ticker) — React only mounts
            or unmounts the box on V. pointer-events-none so it never steals
            paddle clicks. */}
        {showDebug && (
          <div
            ref={debugElRef}
            className="pointer-events-none absolute right-2 top-2 whitespace-pre rounded bg-black/70 px-2 py-1 font-mono text-[10px] leading-tight text-green-300"
          />
        )}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-dim">
        ←/→ or A/D to move · mouse/touch steers too · Space launches · P pauses · V
        debug
      </p>
    </div>
  );
}
