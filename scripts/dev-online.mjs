import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npm = isWindows ? "npm.cmd" : "npm";
const children = [];

function run(name, args) {
  const child = spawn(npm, ["run", ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.log(`[${name}] exited ${signal ?? code ?? 0}`);
    shutdown(code ?? 1);
  });

  children.push(child);
}

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 120);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("Project Lite dev: Vite http://127.0.0.1:5180 + Worker http://127.0.0.1:8787");
run("worker", ["online:dev"]);
run("vite", ["dev:client"]);
