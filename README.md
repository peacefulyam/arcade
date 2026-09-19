# Arcade — one repo, many tiny browser games

Next.js (static export) + TypeScript + Tailwind + PixiJS. A landing page lists
the lineup; each game lives at its own route (`/snake`, `/breakout`, …).

## Run it

```sh
pnpm install
pnpm dev        # http://localhost:3000
```

Other commands: `pnpm typecheck`, `pnpm build` (emits `out/`), `pnpm start`.

## Add a game

1. Append an entry to the registry in `lib/games.ts` (set `status: "playable"`).
2. Create `app/<slug>/page.tsx` — a client component that mounts the game with
   the shared factory in `lib/pixi.ts`:

```tsx
"use client";
import { useEffect, useRef } from "react";
import { createGameApp } from "@/lib/pixi";

export default function SnakeGame() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let app: import("pixi.js").Application | undefined;
    createGameApp(ref.current!).then((a) => {
      app = a;
      // build scene on a.stage, tick via a.ticker …
    });
    return () => app?.destroy(true);
  }, []);
  return <div ref={ref} className="aspect-square w-full" />;
}
```

PixiJS stays client-side only (never import `lib/pixi.ts` from a server
component) so the static export keeps working.

## Deploy to GitHub Pages (free)

1. Push this repo to GitHub (public).
2. Build with the right base path and publish `out/`:
   - User/org site (`peacefulyam.github.io`): `pnpm build`
   - Project site (`peacefulyam.github.io/arcade`):
     `NEXT_BASE_PATH=/arcade pnpm build`
3. Serve `out/` via Pages: Settings → Pages → Deploy from a branch, or push
   `out/` to a `gh-pages` branch. No server needed — it's fully static.
