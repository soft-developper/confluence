// Collect the prerendered docs pages for Pagefind (confluence:pagefind-site).
//
// Nextra's guide runs Pagefind on .next/server/app. Since Next.js 16.3.8, a build that uses
// a build adapter (Vercel sets one) writes each prerendered page to
//   .next/server/route-cache/<kind>/<sha256 of the source route>/$/<path>.html
// instead (see next/dist/server/lib/route-cache-key.js), so Pagefind found no pages.
// This copies the HTML from either layout into .next/pagefind-site, laid out by route
// (index.html, fees.html, getting-started/first-bridge.html, ...) exactly as
// .next/server/app was, so search results keep the same links.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const server = join(".next", "server");
const out = join(".next", "pagefind-site");

function htmlFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith(".html") && statSync(join(dir, file)).isFile());
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const pages = new Map();

// Layout without an adapter (local builds): .next/server/app/<path>.html
const appDir = join(server, "app");
for (const file of htmlFiles(appDir)) pages.set(file, join(appDir, file));

// Layout with an adapter (Vercel): .next/server/route-cache/<kind>/<hash>/$/<path>.html
const cacheDir = join(server, "route-cache");
for (const file of htmlFiles(cacheDir)) {
  const parts = file.split(sep);
  const at = parts.indexOf("$");
  if (at === -1) continue;
  pages.set(parts.slice(at + 1).join(sep), join(cacheDir, file));
}

for (const [route, source] of pages) {
  const target = join(out, route);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target);
}

if (pages.size === 0) {
  console.error(`pagefind-site: no prerendered HTML under ${relative(".", appDir)} or ${relative(".", cacheDir)}`);
  process.exit(1);
}
console.log(`pagefind-site: collected ${pages.size} pages into ${out}`);
