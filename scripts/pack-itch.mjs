// Builds the production bundle and zips dist/ into drift-attack-itch.zip
// Usage: node scripts/pack-itch.mjs   (or: npm run pack:itch)
import { execSync } from "node:child_process";
import { createWriteStream, existsSync, rmSync, statSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ZipArchive } from "archiver";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const zip = resolve(root, "drift-attack-itch.zip");

function fail(message) {
  console.error(`pack:itch: ${message}`);
  if (existsSync(zip)) {
    try { rmSync(zip); } catch { /* best effort */ }
  }
  process.exit(1);
}

// Step 1: Full build including TypeScript validation
console.log("Running full build (tsc + vite build)...");
try {
  execSync("npm run build", { cwd: root, stdio: "inherit" });
} catch (error) {
  fail(`Build failed: ${error.message ?? error}`);
}

if (!existsSync(dist)) {
  fail("dist/ directory does not exist after build.");
}

// Step 2: Remove any previous zip
if (existsSync(zip)) rmSync(zip);

// Step 3: Zip dist/ contents at archive root (no dist/ wrapper)
console.log("Zipping dist/ for itch.io...");
try {
  await new Promise((resolveP, rejectP) => {
    const output = createWriteStream(zip);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    output.on("error", rejectP);
    archive.on("error", rejectP);
    output.on("close", () => {
      console.log(`Zipped ${archive.pointer()} bytes`);
      resolveP();
    });

    archive.pipe(output);
    // false = files at zip root, no dist/ prefix
    archive.directory(dist, false);
    archive.finalize();
  });
} catch (error) {
  fail(`Archive failed: ${error.message ?? error}`);
}

// Step 4: Verify the ZIP — root index.html must exist, no dist/ wrapper
console.log("Verifying archive...");
try {
  const buf = readFileSync(zip);
  if (buf.length < 100) fail("ZIP file is suspiciously small.");

  // Find End of Central Directory record (signature 0x06054b50)
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) fail("Verification failed: no End of Central Directory record found.");

  const cdEntries = buf.readUInt16LE(eocdOffset + 10);
  const cdSize = buf.readUInt32LE(eocdOffset + 12);
  const cdOffset = buf.readUInt32LE(eocdOffset + 16);

  // Parse central directory entries
  const entryNames = [];
  let pos = cdOffset;
  for (let e = 0; e < cdEntries; e++) {
    if (buf[pos] !== 0x50 || buf[pos + 1] !== 0x4b || buf[pos + 2] !== 0x01 || buf[pos + 3] !== 0x02) break;
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    entryNames.push(name);
    pos += 46 + nameLen + extraLen + commentLen;
  }

  // Check root index.html
  if (!entryNames.includes("index.html")) fail("Verification failed: index.html not found at ZIP root.");

  // Check no dist/ wrapper
  if (entryNames.some((n) => n.startsWith("dist/"))) fail("Verification failed: ZIP contains a dist/ wrapper.");

  // Check referenced assets exist — read index.html from dist/ directly
  const htmlContent = readFileSync(resolve(dist, "index.html"), "utf8");
  const assetRefs = [...htmlContent.matchAll(/src="\.\/(assets\/[^"]+)"/g), ...htmlContent.matchAll(/href="\.\/(assets\/[^"]+)"/g)];
  for (const match of assetRefs) {
    if (!entryNames.includes(match[1])) fail(`Verification failed: referenced asset ${match[1]} not found in ZIP.`);
  }

  console.log(`Verification passed: ${cdEntries} entries, index.html at root, ${assetRefs.length} asset(s) verified, no dist/ wrapper.`);
} catch (error) {
  fail(`Verification error: ${error.message ?? error}`);
}

console.log(`\nDone! Upload ${zip} to itch.io as an HTML5 game.`);
