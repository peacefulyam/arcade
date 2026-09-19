import { Application } from "pixi.js";

// Shared PixiJS entry point for every game in the arcade.
// Import and call this ONLY from client components (inside useEffect):
//
//   const app = await createGameApp(ref.current);
//   // ... build your scene on `app.stage`, tick via `app.ticker` ...
//   return () => app.destroy(true);
//
// Keeping one factory means all games share renderer settings and cleanup.
export async function createGameApp(
  container: HTMLElement,
  opts?: { background?: string },
): Promise<Application> {
  const app = new Application();
  await app.init({
    background: opts?.background ?? "#101014",
    resizeTo: container,
    antialias: true,
  });
  container.replaceChildren(app.canvas);
  return app;
}
