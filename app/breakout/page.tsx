import { notFound } from "next/navigation";
import ComingSoon from "@/components/ComingSoon";
import { getGame } from "@/lib/games";

export default function BreakoutPage() {
  const game = getGame("breakout");
  if (!game) notFound();
  return <ComingSoon game={game} />;
}
