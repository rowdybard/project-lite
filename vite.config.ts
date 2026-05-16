import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const mapEditDir = path.resolve(process.cwd(), "public/assets/map-edits");

function sanitizeTrackId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80);
}

function readBody(req: import("node:http").IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) reject(new Error("Body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res: import("node:http").ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(data));
}

function mapEditWriterPlugin(): Plugin {
  return {
    name: "project-lite-map-edit-writer",
    configureServer(server) {
      server.middlewares.use("/api/dev/map-edits", async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://project-lite.local");
        const trackId = sanitizeTrackId(url.pathname.replace(/^\/+/, ""));
        if (!trackId) {
          sendJson(res, 400, { error: "Missing track id" });
          return;
        }

        const filePath = path.join(mapEditDir, `${trackId}.json`);
        try {
          if (req.method === "GET") {
            const raw = await readFile(filePath, "utf8").catch(() => null);
            sendJson(res, raw ? 200 : 404, raw ? JSON.parse(raw) : { edits: [] });
            return;
          }

          if (req.method === "POST") {
            const raw = await readBody(req);
            const parsed = JSON.parse(raw) as { edits?: unknown };
            const edits = Array.isArray(parsed.edits) ? parsed.edits : [];
            await mkdir(mapEditDir, { recursive: true });
            await writeFile(filePath, `${JSON.stringify({ trackId, edits }, null, 2)}\n`, "utf8");
            sendJson(res, 200, { ok: true, path: path.relative(process.cwd(), filePath), edits: edits.length });
            server.ws.send({ type: "full-reload" });
            return;
          }

          if (req.method === "DELETE") {
            await rm(filePath, { force: true });
            sendJson(res, 200, { ok: true });
            server.ws.send({ type: "full-reload" });
            return;
          }
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [mapEditWriterPlugin()],
});

