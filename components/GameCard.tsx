import Link from "next/link";
import type { GameEntry } from "@/lib/games";

export default function GameCard({ game }: { game: GameEntry }) {
  return (
    <Link
      href={`./${game.slug}/`}
      className={`block rounded-lg border border-line bg-panel p-6 transition-colors ${game.accentBorder}`}
    >
      <div className="flex items-center justify-between">
        <h2 className={`text-xl font-bold ${game.accentText}`}>{game.title}</h2>
        <span
          className={`rounded-full border px-3 py-1 text-[11px] tracking-wide ${game.accentChip}`}
        >
          {game.status === "playable" ? "PLAYABLE" : "COMING SOON"}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-dim">{game.blurb}</p>
      <p className={`mt-4 text-sm font-bold ${game.accentText}`}>
        {game.status === "playable" ? "Play →" : "Peek →"}
      </p>
    </Link>
  );
}
