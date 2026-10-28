// Copies only the files a site serves into its output folder.
//
//   node tools/stage-deploy.mjs          the family app → .deploy/
//     (Cloudflare Pages project home-project; functions/ is picked up separately)
//   node ../tools/stage-deploy.mjs --demo   the public demo → demo/site/
//     (Pages project backyard-demo-mhirano, whose root directory is demo/, so it
//     gets no functions/, no wrangler.toml bindings and no secrets: just files)
//
// Leaves out the 31 MB original model, notes, tools and local test data. The
// demo also leaves out Mari's yard model and stamps the page as the demo
// (<meta name="app-mode">, see js/app-mode.js).
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundleBuilder } from "./bundle-builder.mjs";

const DEMO = process.argv.includes("--demo");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = DEMO ? path.join(ROOT, "demo", "site") : path.join(ROOT, ".deploy");
const INCLUDE = DEMO
  ? ["viewer.html", "css", "js", "library", "demo/demo-yard.glb", "demo/examples", "demo/items", "demo/surfaces"]
  : ["viewer.html", "css", "js", "library", "demo/demo-yard.glb", "demo/examples", "demo/items", "demo/surfaces"];

if (DEMO) {
  try {
    await fs.access(path.join(ROOT, "demo", "demo-yard.glb"));
  } catch {
    console.error("demo/demo-yard.glb is missing, so the demo can't be built.");
    process.exit(1);
  }
} else {
  // The server hands Codex's Library builder to Astra (functions/_astra.js).
  await bundleBuilder();
}

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });
for (const entry of INCLUDE) {
  await fs.cp(path.join(ROOT, entry), path.join(OUT, entry), {
    recursive: true,
    // Skip hidden files and folders, and the Library builder's scripts and notes
    // (library/build_library.py, BUILDER.md, CREDITS.md): the app never loads them.
    filter: (src) => !path.basename(src).startsWith(".") && !/\.(py|md)$/.test(src),
  });
}
// The app lives at viewer.html; send the bare address there.
await fs.writeFile(path.join(OUT, "_redirects"), "/ /viewer.html 302\n");

// Version stamp for the "new version available" notice (js/update-check.js):
// a hash of everything staged, so it only changes when something did.
const hash = createHash("sha256");
async function hashDir(dir) {
  for (const e of (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await hashDir(p);
    else hash.update(path.relative(OUT, p)).update(await fs.readFile(p));
  }
}
await hashDir(OUT);
const version = hash.digest("hex").slice(0, 12);
const page = path.join(OUT, "viewer.html");
const html = await fs.readFile(page, "utf8");
if (!html.includes('<meta name="app-version" content="dev" />')) throw new Error("viewer.html has no app-version meta to stamp");
let stamped = html.replace('<meta name="app-version" content="dev" />', `<meta name="app-version" content="${version}" />`);
if (DEMO) {
  if (!stamped.includes('<meta name="app-mode" content="full" />')) throw new Error("viewer.html has no app-mode meta to stamp");
  stamped = stamped.replace('<meta name="app-mode" content="full" />', '<meta name="app-mode" content="demo" />');
}
await fs.writeFile(page, stamped);
await fs.writeFile(path.join(OUT, "version.json"), JSON.stringify({ version }) + "\n");

let files = 0, bytes = 0, largest = { size: 0 };
async function walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else {
      const { size } = await fs.stat(p);
      files++; bytes += size;
      if (size > largest.size) largest = { size, name: path.relative(OUT, p) };
    }
  }
}
await walk(OUT);
console.log(`Staged ${files} files, ${(bytes / 1e6).toFixed(1)} MB in ${path.relative(ROOT, OUT)}/ (largest: ${largest.name}, ${(largest.size / 1e6).toFixed(1)} MB)`);
if (largest.size > 25 * 1024 * 1024) {
  console.error("A file is over Cloudflare Pages' 25 MiB limit.");
  process.exit(1);
}
