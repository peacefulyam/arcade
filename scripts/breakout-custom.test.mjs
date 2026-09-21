// Breakout custom-level behavior tests (run: `pnpm test`).
//
// Zero-dependency: compiles the REAL lib/breakout sources with the repo's own
// tsc into a temp dir (CommonJS) and asserts behavior with node:test. This
// exercises the shipped code — not a reimplementation — so a green run means
// the wall merge, block auto-fill, and wall-collision physics actually hold.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = mkdtempSync(path.join(tmpdir(), "breakout-custom-test-"));
after(() => rmSync(outDir, { recursive: true, force: true }));

const tsc = path.join(root, "node_modules", ".bin", "tsc");
// NOTE: cwd is the temp dir so tsc doesn't pick up the project's tsconfig
// (TS7 errors when files are given alongside a tsconfig).
execFileSync(
  tsc,
  [
    "--target",
    "es2020",
    "--module",
    "commonjs",
    "--skipLibCheck",
    "--outDir",
    outDir,
    ...["config", "levels", "engine", "custom"].map((f) =>
      path.join(root, "lib", "breakout", `${f}.ts`),
    ),
  ],
  { cwd: outDir },
);

const require = createRequire(path.join(outDir, "custom.js"));
const custom = require(path.join(outDir, "custom.js"));
const engine = require(path.join(outDir, "engine.js"));
const config = require(path.join(outDir, "config.js"));
const { DEFAULT_CONFIG } = config;
const {
  CELL,
  GRID_COLS,
  GRID_ROWS,
  autoFillBricks,
  blankGrid,
  blankRows,
  countWallCells,
  createCustomState,
  gridToRows,
  normalizeGapBlocks,
  normalizeRemoved,
  rowsToGrid,
  wallsFromGrid,
} = custom;
const { updateGame } = engine;

const NO_INPUT = { left: false, right: false, pointerX: null };
const DT = 1 / 60;

function defWithWalls(name, paint) {
  const grid = blankGrid();
  paint(grid);
  return {
    id: `test-${name}`,
    name,
    rows: gridToRows(grid),
    createdAt: 0,
    updatedAt: 0,
  };
}

function setCell(grid, c, r) {
  grid[r * GRID_COLS + c] = 1;
}

test("grid constants: 100 square cells across, top-75% span", () => {
  assert.equal(GRID_COLS, 100);
  assert.equal(CELL, 4.8);
  assert.ok(GRID_ROWS * CELL <= 450, "grid stays in the top 75%");
  assert.ok(GRID_ROWS >= 90, "grid covers nearly the whole top 75%");
});

test("wallsFromGrid merges a full painted row into one rect", () => {
  const grid = blankGrid();
  for (let c = 0; c < GRID_COLS; c++) setCell(grid, c, 0);
  const walls = wallsFromGrid(grid);
  assert.equal(walls.length, 1);
  assert.deepEqual(walls[0], { x: 0, y: 0, w: 480, h: 4.8 });
});

test("wallsFromGrid keeps separated runs as separate rects", () => {
  const grid = blankGrid();
  setCell(grid, 5, 2);
  setCell(grid, 10, 2);
  setCell(grid, 11, 2);
  const walls = wallsFromGrid(grid);
  assert.equal(walls.length, 2);
  assert.deepEqual(walls[0], { x: 5 * CELL, y: 2 * CELL, w: CELL, h: CELL });
  assert.deepEqual(walls[1], {
    x: 10 * CELL,
    y: 2 * CELL,
    w: 2 * CELL,
    h: CELL,
  });
});

test("rows/grid round-trip preserves walls", () => {
  const grid = blankGrid();
  setCell(grid, 0, 0);
  setCell(grid, 99, GRID_ROWS - 1);
  assert.deepEqual(rowsToGrid(gridToRows(grid)), grid);
});

test("autoFillBricks on an empty grid: full field of half-size blocks", () => {
  const bricks = autoFillBricks(DEFAULT_CONFIG, blankGrid());
  assert.equal(bricks.length, 375);
  const stdW =
    (DEFAULT_CONFIG.worldW -
      DEFAULT_CONFIG.brickSide * 2 -
      DEFAULT_CONFIG.brickGap * (DEFAULT_CONFIG.brickCols - 1)) /
    DEFAULT_CONFIG.brickCols;
  for (const b of bricks) {
    assert.equal(b.w, stdW / 2);
    assert.equal(b.h, DEFAULT_CONFIG.brickH / 2);
    assert.ok(b.x >= DEFAULT_CONFIG.brickSide);
    assert.ok(b.x + b.w <= DEFAULT_CONFIG.worldW - DEFAULT_CONFIG.brickSide);
    assert.ok(b.y >= DEFAULT_CONFIG.brickTop);
    assert.ok(b.y + b.h <= 450);
    assert.equal(b.hp, 1);
  }
});

test("autoFillBricks never overlaps a wall cell", () => {
  const grid = blankGrid();
  // Horizontal bar + a box enclosure.
  for (let c = 10; c < 90; c++) setCell(grid, c, 20);
  for (let c = 30; c <= 70; c++) {
    setCell(grid, c, 40);
    setCell(grid, c, 60);
  }
  for (let r = 40; r <= 60; r++) {
    setCell(grid, 30, r);
    setCell(grid, 70, r);
  }
  const bricks = autoFillBricks(DEFAULT_CONFIG, grid);
  assert.ok(bricks.length > 0 && bricks.length < 375);
  for (const b of bricks) {
    const c0 = Math.floor(b.x / CELL);
    const c1 = Math.floor((b.x + b.w - 1e-6) / CELL);
    const r0 = Math.floor(b.y / CELL);
    const r1 = Math.floor((b.y + b.h - 1e-6) / CELL);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (r < 0 || r >= GRID_ROWS || c < 0 || c >= GRID_COLS) continue;
        assert.equal(
          grid[r * GRID_COLS + c],
          0,
          `brick ${b.id} overlaps wall cell (${c},${r})`,
        );
      }
    }
  }
});

test("autoFillBricks on a fully walled grid yields zero blocks", () => {
  const grid = blankGrid().fill(1);
  assert.equal(autoFillBricks(DEFAULT_CONFIG, grid).length, 0);
});

test("ball bounces off a custom wall: reflects, never penetrates, keeps speed", () => {
  const def = defWithWalls("column", (grid) => {
    for (let r = 0; r < GRID_ROWS; r++) setCell(grid, 50, r);
  });
  const state = createCustomState(DEFAULT_CONFIG, def);
  assert.equal(state.phase, "aim");
  assert.equal(state.lives, DEFAULT_CONFIG.lives);
  assert.equal(state.walls.length, GRID_ROWS);

  // Isolate wall physics: one brick parked far off the test corridor (an
  // empty brick list would instantly trigger the all-cleared win check).
  state.bricks = [
    {
      id: 0,
      col: 0,
      row: 0,
      x: 30,
      y: 80,
      w: 10,
      h: 10,
      hp: 1,
      maxHp: 1,
      color: 0xf0b429,
      alive: true,
    },
  ];
  state.phase = "playing";
  state.ball.pos = { x: 200, y: 200 };
  state.ball.vel = { x: 360, y: 0 };
  let bounces = 0;
  const wallX = 50 * CELL;
  for (let i = 0; i < 30; i++) {
    updateGame(state, NO_INPUT, DT, DEFAULT_CONFIG, {
      onWallBounce: () => bounces++,
    });
    assert.equal(state.phase, "playing");
    assert.ok(
      state.ball.pos.x + state.ball.radius <= wallX + 1e-6,
      `tick ${i}: ball penetrated the wall`,
    );
  }
  assert.ok(bounces >= 1, "expected at least one wall bounce");
  assert.equal(state.ball.vel.x, -360);
  assert.equal(state.ball.vel.y, 0);
  assert.equal(Math.hypot(state.ball.vel.x, state.ball.vel.y), 360);
});

test("ball wedged between a wall and a brick never tunnels through", () => {
  // Regression: with discrete wall overlap tested BEFORE bricks, a substep
  // touching both let the brick's penetration shove (~19px) teleport the
  // ball clean past the 4.8px wall — the reported "through the wall" bug.
  const def = defWithWalls("sandwich", (grid) => {
    for (let r = 0; r < GRID_ROWS; r++) setCell(grid, 50, r);
  });
  const state = createCustomState(DEFAULT_CONFIG, def);
  // One brick tight against the wall's left face (0.2px gap) + one parked
  // far away so the level can't clear mid-test.
  state.bricks = [
    { id: 0, col: 0, row: 0, x: 226, y: 195, w: 10, h: 10, hp: 1, maxHp: 1, color: 0xf0b429, alive: true },
    { id: 1, col: 0, row: 1, x: 30, y: 80, w: 10, h: 10, hp: 1, maxHp: 1, color: 0xf0b429, alive: true },
  ];
  const wallX = 50 * CELL;
  state.phase = "playing";
  state.ball.pos = { x: 233, y: 200 };
  state.ball.vel = { x: 360, y: 0 };
  let bounces = 0;
  for (let i = 0; i < 60; i++) {
    updateGame(state, NO_INPUT, DT, DEFAULT_CONFIG, {
      onWallBounce: () => bounces++,
    });
    assert.equal(state.phase, "playing");
    assert.ok(
      state.ball.pos.x + state.ball.radius <= wallX + 1e-6,
      `tick ${i}: tunneled past the wall (x=${state.ball.pos.x})`,
    );
    assert.equal(Math.hypot(state.ball.vel.x, state.ball.vel.y), 360);
  }
  assert.ok(bounces >= 1, "expected at least one wall bounce");
});

test("fuzz: random wall sandwiches never leak the ball (seeded)", () => {
  // Deterministic RNG — same scenarios every run, no flakes.
  const rng = (() => {
    let s = 123456789;
    return () => {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  for (let scen = 0; scen < 20; scen++) {
    const col = 20 + Math.floor(rng() * 60); // wall column, away from edges
    const wallX = col * CELL;
    const def = defWithWalls(`fuzz${scen}`, (grid) => {
      for (let r = 0; r < GRID_ROWS; r++) setCell(grid, col, r);
    });
    const state = createCustomState(DEFAULT_CONFIG, def);
    // Full-height wall: going AROUND is impossible, so any crossing is a
    // genuine tunneling failure (the grid only spans the top 75%, hence the
    // manual extension — engine behavior is what's under test).
    state.walls = [{ x: wallX, y: 0, w: CELL, h: 600 }];
    // Scatter 1–3 near-indestructible bricks hugging either face (hp 100 so
    // scenarios run the full 300 ticks instead of clearing early).
    state.bricks = [];
    const nBricks = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < nBricks; i++) {
      const left = rng() < 0.5;
      const bx = left ? wallX - 8 - rng() * 20 : wallX + CELL + rng() * 20;
      const by = 60 + rng() * 320;
      state.bricks.push({
        id: i, col: 0, row: i, x: bx, y: by, w: 10 + rng() * 14, h: 10,
        hp: 100, maxHp: 100, color: 0xf0b429, alive: true,
      });
    }
    // Ball starts on a random side, adjacent, with a random 360px/s heading.
    const side = rng() < 0.5 ? -1 : 1;
    state.phase = "playing";
    state.ball.pos = {
      x: side < 0 ? wallX - 7 - rng() * 4 : wallX + CELL + 7 + rng() * 4,
      y: 80 + rng() * 300,
    };
    const ang = rng() * Math.PI * 2;
    state.ball.vel = { x: Math.cos(ang) * 360, y: Math.sin(ang) * 360 };
    for (let i = 0; i < 300; i++) {
      updateGame(state, NO_INPUT, DT, DEFAULT_CONFIG, {});
      if (state.phase !== "playing") break; // cleared: scenario over
      const { pos, vel } = state.ball;
      assert.ok(Number.isFinite(pos.x) && Number.isFinite(pos.y), `scen ${scen} tick ${i}: NaN position`);
      // The ball may touch the wall but must never END a tick embedded past
      // its mid-plane on the far side (that is the tunneling signature).
      const d = pos.x - (wallX + CELL / 2);
      assert.ok(
        Math.sign(d) === side || Math.abs(d) <= CELL / 2 + 7 + 1e-6,
        `scen ${scen} tick ${i}: crossed the wall (x=${pos.x})`,
      );
      assert.ok(
        Math.abs(Math.hypot(vel.x, vel.y) - 360) < 1e-6,
        `scen ${scen} tick ${i}: speed changed`,
      );
    }
  }
});

test("ball rattles inside a walled enclosure and breaks blocks", () => {
  const C0 = 30;
  const C1 = 70;
  const R0 = 40;
  const R1 = 60;
  const def = defWithWalls("box", (grid) => {
    for (let c = C0; c <= C1; c++) {
      setCell(grid, c, R0);
      setCell(grid, c, R1);
    }
    for (let r = R0; r <= R1; r++) {
      setCell(grid, C0, r);
      setCell(grid, C1, r);
    }
  });
  const state = createCustomState(DEFAULT_CONFIG, def);
  const x0 = C0 * CELL;
  const x1 = (C1 + 1) * CELL;
  const y0 = R0 * CELL;
  const y1 = (R1 + 1) * CELL;

  state.phase = "playing";
  state.ball.pos = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  state.ball.vel = { x: 200, y: -200 };
  const speed = Math.hypot(200, 200);
  const bricksBefore = state.bricks.filter((b) => b.alive).length;
  assert.ok(bricksBefore > 0, "enclosure should contain fill blocks");
  let bounces = 0;
  for (let i = 0; i < 600; i++) {
    updateGame(state, NO_INPUT, DT, DEFAULT_CONFIG, {
      onWallBounce: () => bounces++,
    });
    if (state.phase !== "playing") break;
    const { pos, radius } = state.ball;
    assert.ok(pos.x - radius >= x0 - 1e-6, `tick ${i}: escaped left`);
    assert.ok(pos.x + radius <= x1 + 1e-6, `tick ${i}: escaped right`);
    assert.ok(pos.y - radius >= y0 - 1e-6, `tick ${i}: escaped top`);
    assert.ok(pos.y + radius <= y1 + 1e-6, `tick ${i}: escaped bottom`);
    assert.ok(
      Math.abs(Math.hypot(state.ball.vel.x, state.ball.vel.y) - speed) < 1e-6,
      `tick ${i}: ball changed speed`,
    );
  }
  assert.ok(bounces > 5, `expected rapid rattling, got ${bounces} bounces`);
  const bricksAfter = state.bricks.filter((b) => b.alive).length;
  assert.ok(bricksAfter < bricksBefore, "enclosed ball should break blocks");
  assert.ok(state.score > 0);
});

test("blank custom level: no walls, full block field", () => {
  const state = createCustomState(DEFAULT_CONFIG, {
    id: "test-blank",
    name: "blank",
    rows: blankRows(),
    createdAt: 0,
    updatedAt: 0,
  });
  assert.deepEqual(state.walls, []);
  assert.equal(state.bricks.length, 375);
});

test("countWallCells counts painted cells", () => {
  const grid = blankGrid();
  setCell(grid, 1, 1);
  setCell(grid, 2, 1);
  assert.equal(countWallCells(grid), 2);
  assert.equal(countWallCells(blankGrid()), 0);
});

test("gap slider aims the paddle end: small gap reaches low, big gap ends high", () => {
  const grid = blankGrid();
  const bh = DEFAULT_CONFIG.brickH / 2;
  const near = autoFillBricks(DEFAULT_CONFIG, grid, 2, []);
  const far = autoFillBricks(DEFAULT_CONFIG, grid, 30, []);
  assert.equal(near.length, 465);
  assert.equal(far.length, 150);
  const bottom = (bricks) => Math.max(...bricks.map((b) => b.y + b.h));
  // Field bottoms sit ~at paddleY minus the gap…
  assert.ok(Math.abs(bottom(near) - (DEFAULT_CONFIG.paddleY - 2 * bh)) < 8);
  assert.ok(Math.abs(bottom(far) - (DEFAULT_CONFIG.paddleY - 30 * bh)) < 8);
  // …while the top stays pinned at the built-in brickTop.
  for (const b of [...near, ...far]) {
    assert.ok(b.y >= DEFAULT_CONFIG.brickTop);
  }
});

test("default gap reproduces the classic 76..450 field exactly", () => {
  const bricks = autoFillBricks(DEFAULT_CONFIG, blankGrid());
  assert.equal(bricks.length, 375);
  assert.equal(bricks[0].y, 77.5);
});

test("removed cutouts erase exactly the covered blocks, restore brings them back", () => {
  const grid = blankGrid();
  const full = autoFillBricks(DEFAULT_CONFIG, grid);
  const victim = full[0];
  const cutout = [{ x: victim.x, y: victim.y, w: victim.w, h: victim.h }];
  const cut = autoFillBricks(DEFAULT_CONFIG, grid, undefined, cutout);
  assert.equal(cut.length, full.length - 1);
  for (const b of cut) {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    assert.ok(
      !(cx >= victim.x && cx <= victim.x + victim.w && cy >= victim.y && cy <= victim.y + victim.h),
      `brick ${b.id} should have been erased`,
    );
  }
  // Restoring = dropping the cutout: the full field returns.
  assert.equal(autoFillBricks(DEFAULT_CONFIG, grid).length, full.length);
});

test("cutouts stay put when the slider reshapes the fill grid", () => {
  const grid = blankGrid();
  // Erase one block of the default (10-gap) field. Nudging the slider to 11
  // shifts rows by ~2px, so the SAME cutout must drop exactly the block
  // sitting in it there too; yanking it to 20 must at least never leave a
  // block center inside the erased zone.
  const at10 = autoFillBricks(DEFAULT_CONFIG, grid);
  const victim = at10[200];
  const cutout = [{ x: victim.x, y: victim.y, w: victim.w, h: victim.h }];
  const inside = (b) => {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    return cx >= victim.x && cx <= victim.x + victim.w && cy >= victim.y && cy <= victim.y + victim.h;
  };
  const moved11 = autoFillBricks(DEFAULT_CONFIG, grid, 11, cutout);
  const at11 = autoFillBricks(DEFAULT_CONFIG, grid, 11, []);
  assert.equal(moved11.length, at11.length - 1);
  assert.ok(moved11.every((b) => !inside(b)));
  const moved20 = autoFillBricks(DEFAULT_CONFIG, grid, 20, cutout);
  const at20 = autoFillBricks(DEFAULT_CONFIG, grid, 20, []);
  assert.ok(moved20.length <= at20.length);
  assert.ok(moved20.every((b) => !inside(b)));
});

test("createCustomState honors blockGap and removed", () => {
  const grid = blankGrid();
  const victim = autoFillBricks(DEFAULT_CONFIG, grid)[0];
  const cutout = [{ x: victim.x, y: victim.y, w: victim.w, h: victim.h }];
  const state = createCustomState(DEFAULT_CONFIG, {
    id: "test-refined",
    name: "refined",
    rows: gridToRows(grid),
    createdAt: 0,
    updatedAt: 0,
    blockGap: 20,
    removed: cutout,
  });
  const expected = autoFillBricks(DEFAULT_CONFIG, grid, 20, cutout);
  assert.equal(state.bricks.length, expected.length);
  const bh = DEFAULT_CONFIG.brickH / 2;
  for (const b of state.bricks) {
    assert.ok(b.y + b.h <= DEFAULT_CONFIG.paddleY - 20 * bh + 1);
  }
});

test("saves without blockGap/removed still load with defaults", () => {
  const state = createCustomState(DEFAULT_CONFIG, {
    id: "test-legacy",
    name: "legacy",
    rows: blankRows(),
    createdAt: 0,
    updatedAt: 0,
  });
  assert.equal(state.bricks.length, 375);
  assert.deepEqual(state.walls, []);
});

test("legacy fillTop is ignored in favor of the default paddle gap", () => {
  const state = createCustomState(DEFAULT_CONFIG, {
    id: "test-filltop",
    name: "filltop",
    rows: blankRows(),
    createdAt: 0,
    updatedAt: 0,
    fillTop: 200,
  });
  assert.equal(state.bricks.length, 375);
});

test("normalizeGapBlocks defaults, rounds, and clamps wild values", () => {
  assert.equal(normalizeGapBlocks(undefined), 10);
  assert.equal(normalizeGapBlocks(NaN), 10);
  assert.equal(normalizeGapBlocks(1000), 30);
  assert.equal(normalizeGapBlocks(0), 2);
  assert.equal(normalizeGapBlocks(12.7), 13);
  assert.equal(normalizeGapBlocks(20), 20);
});

test("normalizeRemoved keeps valid rects, drops garbage", () => {
  const good = { x: 1, y: 2, w: 3, h: 4 };
  assert.deepEqual(normalizeRemoved(undefined), []);
  assert.deepEqual(normalizeRemoved([good, null, { x: 1 }, { x: 0, y: 0, w: -1, h: 2 }]), [good]);
});
