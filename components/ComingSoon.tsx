import Link from "next/link";
import type { GameEntry } from "@/lib/games";

export default function ComingSoon({ game }: { game: GameEntry }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-8">
      <span
        className={`inline-block rounded-full border px-3 py-1 text-[11px] tracking-wide ${game.accentChip}`}
      >
        COMING SOON
      </span>
      <h1 className={`mt-4 text-3xl font-bold tracking-tight ${game.accentText}`}>
        {game.title}
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-dim">{game.blurb}</p>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-dim">
        The cabinet is wired but the cartridge isn&apos;t in yet. Check back soon.
      </p>
      <Link href="../" className="mt-6 inline-block text-sm font-bold underline underline-offset-4">
        ← Back to the arcade
      </Link>
    </div>
  );
}
