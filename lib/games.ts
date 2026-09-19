export type GameStatus = "playable" | "coming-soon";

export interface GameEntry {
  slug: string;
  title: string;
  blurb: string;
  status: GameStatus;
  /** Tailwind accent classes for this game's card + page. */
  accentText: string;
  accentBorder: string;
  accentChip: string;
}

// Single source of truth for the arcade lineup. To add a game: append an entry
// here and create app/<slug>/page.tsx. The landing grid picks it up automatically.
export const games: GameEntry[] = [
  {
    slug: "snake",
    title: "Snake",
    blurb: "Eat, grow, don't bite yourself. The grid classic.",
    status: "coming-soon",
    accentText: "text-phosphor",
    accentBorder: "hover:border-phosphor",
    accentChip: "border-phosphor text-phosphor",
  },
  {
    slug: "breakout",
    title: "Breakout",
    blurb: "One paddle, one ball, a wall of bricks to clear.",
    status: "coming-soon",
    accentText: "text-ambercab",
    accentBorder: "hover:border-ambercab",
    accentChip: "border-ambercab text-ambercab",
  },
];

export function getGame(slug: string): GameEntry | undefined {
  return games.find((g) => g.slug === slug);
}
