import type { NextConfig } from "next";

// Static export so the arcade can be hosted on GitHub Pages (or any static host).
// Project pages (peacefulyam.github.io/<repo>) need a base path:
//   NEXT_BASE_PATH=/arcade pnpm build
// A user/org site (peacefulyam.github.io) needs none.
const basePath = process.env.NEXT_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  images: { unoptimized: true },
};

export default nextConfig;
