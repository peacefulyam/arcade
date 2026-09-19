import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Arcade — small browser games",
  description: "One repo, many tiny games. Built by Peaceful Yamaha.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <div className="mx-auto max-w-3xl px-6">
          <header className="flex items-baseline justify-between border-b border-line py-5">
            <a href="./" className="text-lg font-bold tracking-tight">
              ARCADE<span className="text-phosphor">.</span>
            </a>
            <p className="text-xs text-dim">small games, one repo</p>
          </header>
          <main className="py-10">{children}</main>
          <footer className="border-t border-line py-5 text-xs text-dim">
            Built by Peaceful Yamaha · static site, no servers
          </footer>
        </div>
      </body>
    </html>
  );
}
