// ─────────────────────────────────────────────────────────────────────────────
// BreakoutManager.tsx — the custom-mode SHELL around the game.
//
// Three tabs: Play (built-in level or a selected custom level), Levels (the
// saved custom list: play / edit / delete / new), and Editor (the drawing
// app). The game component remounts on every level switch via `key`, so each
// run boots a pristine sim — this shell never touches game state directly.
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useEffect, useMemo, useState } from "react";
import BreakoutGame from "./BreakoutGame";
import CustomEditor from "./CustomEditor";
import { DEFAULT_CONFIG } from "@/lib/breakout/config";
import {
  autoFillBricks,
  countWallCells,
  loadCustomLevels,
  persistCustomLevels,
  rowsToGrid,
} from "@/lib/breakout/custom";
import type { CustomLevelDef, LevelSource } from "@/lib/breakout/types";

type Tab = "play" | "levels" | "editor";

export default function BreakoutManager() {
  const [tab, setTab] = useState<Tab>("play");
  const [levels, setLevels] = useState<CustomLevelDef[]>([]);
  // The def loaded in the editor (null = brand-new). Keyed by id at render.
  const [editing, setEditing] = useState<CustomLevelDef | null>(null);
  // The custom level loaded in the Play tab (null = built-in level).
  const [activeCustom, setActiveCustom] = useState<CustomLevelDef | null>(null);

  // localStorage is client-only: hydrate after mount (server gets []).
  useEffect(() => {
    setLevels(loadCustomLevels());
  }, []);

  const store = (next: CustomLevelDef[]) => {
    setLevels(next);
    persistCustomLevels(next);
  };

  const handleSave = (def: CustomLevelDef) => {
    const exists = levels.some((l) => l.id === def.id);
    store(
      exists
        ? levels.map((l) => (l.id === def.id ? def : l))
        : [...levels, def],
    );
    if (activeCustom?.id === def.id) setActiveCustom(def);
    setTab("levels");
  };

  const handleDelete = (def: CustomLevelDef) => {
    if (!window.confirm(`Delete "${def.name}"? This can't be undone.`)) return;
    store(levels.filter((l) => l.id !== def.id));
    if (activeCustom?.id === def.id) setActiveCustom(null);
  };

  const playCustom = (def: CustomLevelDef) => {
    setActiveCustom(def);
    setTab("play");
  };

  const newLevel = () => {
    setEditing(null);
    setTab("editor");
  };

  // Per-level stats for the list (wall cells + resulting block count,
  // honoring each level's fill start and erased blocks).
  const stats = useMemo(() => {
    const m = new Map<string, { walls: number; bricks: number }>();
    for (const l of levels) {
      const grid = rowsToGrid(l.rows);
      m.set(l.id, {
        walls: countWallCells(grid),
        bricks: autoFillBricks(DEFAULT_CONFIG, grid, l.blockGap, l.removed).length,
      });
    }
    return m;
  }, [levels]);

  const source: LevelSource = activeCustom
    ? { kind: "custom", level: activeCustom }
    : { kind: "builtin", index: 0 };
  const gameKey = activeCustom
    ? `custom-${activeCustom.id}-${activeCustom.updatedAt}`
    : "builtin-0";

  const tabBtn = (id: Tab, label: string) =>
    tab === id ? (
      <button
        key={id}
        className="rounded border border-phosphor px-3 py-1 text-xs font-bold text-phosphor"
      >
        {label}
      </button>
    ) : (
      <button
        key={id}
        onClick={() => setTab(id)}
        className="rounded border border-line px-3 py-1 text-xs text-dim hover:text-bone"
      >
        {label}
      </button>
    );

  const btn = "rounded border border-line px-2 py-1 text-xs text-dim hover:text-bone";

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        {tabBtn("play", "Play")}
        {tabBtn("levels", `Custom levels${levels.length ? ` (${levels.length})` : ""}`)}
        {tabBtn("editor", "Level editor")}
      </div>

      {tab === "play" && (
        <div>
          {activeCustom && (
            <div className="mb-3 flex items-center justify-between text-sm">
              <div>
                <span className="text-dim">CUSTOM </span>
                <span className="font-bold text-phosphor">{activeCustom.name}</span>
              </div>
              <button onClick={() => setActiveCustom(null)} className={btn}>
                Back to built-in
              </button>
            </div>
          )}
          <BreakoutGame key={gameKey} source={source} />
          {!activeCustom && levels.length > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-dim">
              Made something?{" "}
              <button
                onClick={() => setTab("levels")}
                className="font-bold underline underline-offset-4 hover:text-bone"
              >
                Play a custom level
              </button>
            </p>
          )}
        </div>
      )}

      {tab === "levels" && (
        <div>
          <button
            onClick={newLevel}
            className="rounded border border-phosphor px-4 py-2 text-sm font-bold text-phosphor hover:bg-phosphor hover:text-cabinet"
          >
            + New custom level
          </button>
          {levels.length === 0 ? (
            <p className="mt-4 text-sm leading-relaxed text-dim">
              No custom levels yet. Draw walls on a 100-wide grid, the game
              fills the rest with half-size blocks, and the ball ricochets
              through your enclosures.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {levels.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-bone">{l.name}</p>
                    <p className="text-xs text-dim">
                      {stats.get(l.id)?.walls ?? 0} wall cells ·{" "}
                      {stats.get(l.id)?.bricks ?? 0} blocks
                    </p>
                  </div>
                  <button onClick={() => playCustom(l)} className={btn}>
                    Play
                  </button>
                  <button
                    onClick={() => {
                      setEditing(l);
                      setTab("editor");
                    }}
                    className={btn}
                  >
                    Edit
                  </button>
                  <button onClick={() => handleDelete(l)} className={btn}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "editor" && (
        <CustomEditor
          key={editing?.id ?? "new"}
          initial={editing}
          onSave={handleSave}
          // Playtest runs the current canvas as-is (saved or not) — the saved
          // list only changes via Save.
          onPlay={playCustom}
          onCancel={() => setTab("levels")}
        />
      )}
    </div>
  );
}
