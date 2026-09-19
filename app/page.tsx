import GameCard from "@/components/GameCard";
import { games } from "@/lib/games";

export default function Home() {
  return (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">
        Pick your poison<span className="text-phosphor">.</span>
      </h1>
      <p className="mt-3 max-w-lg text-sm leading-relaxed text-dim">
        A growing shelf of tiny browser games. Each one lives at its own address,
        rendered with PixiJS, no servers involved.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {games.map((game) => (
          <GameCard key={game.slug} game={game} />
        ))}
      </div>
    </div>
  );
}
