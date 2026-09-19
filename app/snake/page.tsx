import { notFound } from "next/navigation";
import ComingSoon from "@/components/ComingSoon";
import { getGame } from "@/lib/games";

export default function SnakePage() {
  const game = getGame("snake");
  if (!game) notFound();
  return <ComingSoon game={game} />;
}
