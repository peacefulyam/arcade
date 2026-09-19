import Link from "next/link";
import { notFound } from "next/navigation";
import BreakoutGame from "./BreakoutGame";
import { getGame } from "@/lib/games";

export const metadata = {
  title: "Breakout — Arcade",
  description: "One paddle, one ball, a wall of bricks to clear.",
};

export default function BreakoutPage() {
  const game = getGame("breakout");
  if (!game) notFound();

  return (
    <div>
      <span
        className={`inline-block rounded-full border px-3 py-1 text-[11px] tracking-wide ${game.accentChip}`}
      >
        PLAYABLE
      </span>
      <h1 className={`mt-4 text-3xl font-bold tracking-tight ${game.accentText}`}>
        {game.title}
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-dim">{game.blurb}</p>

      <div className="mx-auto mt-6 max-w-[480px]">
        <BreakoutGame />
      </div>

      {/* Where the code lives, for the curious reader-developer. */}
      <details className="mx-auto mt-6 max-w-[480px] text-xs leading-relaxed text-dim">
        <summary className="cursor-pointer font-bold text-bone">
          How this game is built (code tour)
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <code>lib/breakout/types.ts</code> — shared vocabulary (state,
            config, input, events). Start here.
          </li>
          <li>
            <code>lib/breakout/config.ts</code> — every tunable number +
            difficulty presets for later.
          </li>
          <li>
            <code>lib/breakout/levels.ts</code> — levels as ASCII maps; add one
            to design level 2.
          </li>
          <li>
            <code>lib/breakout/engine.ts</code> — the simulation: game loop,
            collisions, paddle steering. No Pixi, no DOM.
          </li>
          <li>
            <code>lib/breakout/renderer.ts</code> — Pixi scene graph that
            mirrors the simulation.
          </li>
          <li>
            <code>lib/breakout/sound.ts</code> — WebAudio bleeps, no audio
            files.
          </li>
          <li>
            <code>app/breakout/BreakoutGame.tsx</code> — React wiring: input,
            ticker, HUD.
          </li>
        </ul>
      </details>

      <Link
        href="../"
        className="mt-6 inline-block text-sm font-bold underline underline-offset-4"
      >
        ← Back to the arcade
      </Link>
    </div>
  );
}
