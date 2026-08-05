// Builds the production bundle and zips dist/ into drift-attack-itch.zip
// Usage: node scripts/pack-itch.mjs
import { execSync } from "node:child_process";
import { createWriteStream, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createArchiver } from "archiver";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const zip = resolve(root, "drift-attack-itch.zip");

console.log("Building production bundle...");
execSync("npx vite build", { cwd: root, stdio: "inherit" });

if (existsSync(zip)) rmSync(zip);

console.log("Zipping dist/ for itch.io...");
await new Promise((resolveP, rejectP) => {
  const output = createWriteStream(zip);
  const archive = archiver("zip", { zlib: { level: 9 } });
  output.on("close", () => {
    console.log(`Zipped ${archive.pointer()} bytes`);
    resolveP();
  });
  output.on("error", rejectP);
  archive.on("error", rejectP);
  archive.pipe(output);
  archive.directory(dist, false); // false = files at zip root (no dist/ wrapper)
  archive.finalize();
});

console.log(`\nDone! Upload ${zip} to itch.io as an HTML5 game.`);
