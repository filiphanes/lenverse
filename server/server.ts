#!/usr/bin/env bun
// server.ts — LenVerse flat-file server (Bun).
//
// Serves ROOT at /, like the Go/C legacy servers.
//
//   GET    /<path>     → serve file or directory listing
//   PUT    /<path>     → write file + broadcast (blocked for modules/**)
//   WS     /<path>     → subscribe to changes on that file
//   OPTIONS /<path>    → CORS preflight
//
// Module extensions (modules/<id>/index.ts) are loaded at boot and can
// register Replicants and custom HTTP routes under /<id>/.

import { readdir, stat, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve, extname, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { networkInterfaces } from "node:os";
import type { ServerWebSocket } from "bun";
import { Module, type Manifest, type ModuleHost } from "./api";

const ROOT = process.env.LENVERSE_DIR || resolve(import.meta.dir, "..");
const MODULES = join(ROOT, "modules");
const PORT = Number(process.env.PORT ?? 5005);
const HOST = process.env.HOST ?? "127.0.0.1";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".ts":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt":  "text/plain; charset=utf-8",
  ".md":   "text/markdown; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif":  "image/gif",
  ".mp3":  "audio/mpeg",
  ".mp4":  "video/mp4",
  ".webm": "video/webm",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type WSData = { topic: string; absPath: string };
const subscribers = new Map<string, Set<ServerWebSocket<WSData>>>();
const modules = new Map<string, Module>();

function safePath(urlPath: string): string | null {
  const rel = urlPath.replace(/^\/+/, "") || ".";
  const abs = resolve(ROOT, rel);
  const root = resolve(ROOT);
  const norm = (p: string) => p.replace(/\\/g, "/");
  if (norm(abs) !== norm(root) && !norm(abs).startsWith(norm(root) + "/")) return null;
  return abs;
}

async function dirListing(dir: string): Promise<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter(e => !e.name.startsWith("."))
    .map(e => e.isDirectory() ? e.name + "/" : e.name)
    .join("\n") + "\n";
}

async function serveFile(absPath: string): Promise<Response> {
  let st;
  try { st = await stat(absPath); }
  catch { return new Response("Not found", { status: 404, headers: CORS }); }
  if (st.isDirectory()) {
    return new Response(await dirListing(absPath), {
      headers: { "Content-Type": "text/plain; charset=utf-8", ...CORS },
    });
  }
  const file = Bun.file(absPath);
  const type = MIME[extname(absPath).toLowerCase()] ?? file.type ?? "application/octet-stream";
  return new Response(file, { headers: { "Content-Type": type, ...CORS } });
}

function broadcast(topic: string, data: string, except?: ServerWebSocket<WSData>) {
  const set = subscribers.get(topic);
  if (!set) return;
  for (const ws of set) if (ws !== except) ws.send(data);
}

const host: ModuleHost = {
  async writeData(id, sub, body) {
    const mod = modules.get(id);
    if (!mod) throw new Error(`Unknown module: ${id}`);
    const abs = mod.resolve(sub);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body);
    const topic = relative(ROOT, abs).replace(/\\/g, "/");
    broadcast(topic, body);
    mod._ingest(sub, body);
  },
  broadcast(id, sub, body) {
    const mod = modules.get(id);
    if (!mod) return;
    const topic = relative(ROOT, mod.resolve(sub)).replace(/\\/g, "/");
    broadcast(topic, body);
    mod._ingest(sub, body);
  },
  resolveData(id, sub) {
    const mod = modules.get(id);
    if (!mod) return null;
    try { return mod.resolve(sub); }
    catch { return null; }
  },
};

async function discoverModules() {
  let entries;
  try { entries = await readdir(MODULES, { withFileTypes: true }); }
  catch { return; }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "shared") continue;
    const codeDir = join(MODULES, e.name);
    const manifestPath = join(codeDir, "package.json");
    if (!existsSync(manifestPath)) continue;

    let manifest: Manifest;
    try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
    catch (err) { console.error(`bad manifest for ${e.name}:`, err); continue; }

    const dataDir = join(ROOT, "var", e.name);
    await mkdir(dataDir, { recursive: true });

    const mod = new Module({ id: e.name, manifest, dataDir, codeDir, host });
    modules.set(e.name, mod);

    for (const ext of ["index.ts", "index.js", "index.mjs"]) {
      const entry = join(codeDir, ext);
      if (!existsSync(entry)) continue;
      try {
        const url = pathToFileURL(entry).href + `?v=${Date.now()}`;
        const m = await import(url);
        const setup = m.default ?? m.setup;
        if (typeof setup === "function") {
          await setup(mod);
          console.log(`loaded extension: modules/${e.name}/${ext}`);
        }
      } catch (err) {
        console.error(`failed to load modules/${e.name}/${ext}:`, err);
      }
      break;
    }
  }
}

function manifestList() {
  return [...modules.values()].map(m => ({ id: m.id, ...m.manifest }));
}

function lanIPs(): string[] {
  const ips: string[] = [];
  for (const iface of Object.values(networkInterfaces())) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family === "IPv4" && !addr.internal) ips.push(addr.address);
    }
  }
  return ips;
}

await discoverModules();

const server = Bun.serve<WSData, {}>({
  hostname: HOST,
  port: PORT,

  async fetch(req, server) {
    const url = new URL(req.url);
    const path = decodeURIComponent(url.pathname);
    console.log(req.method, path.replace(/^\/+/, ""));

    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: CORS });

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const abs = safePath(path);
      if (!abs) return new Response("Forbidden", { status: 403 });
      const root = resolve(ROOT);
      const norm = (p: string) => p.replace(/\\/g, "/");
      if (norm(abs) !== norm(root) && !norm(abs).startsWith(norm(root) + "/"))
        return new Response("Forbidden", { status: 403 });
      const topic = relative(ROOT, abs).replace(/\\/g, "/");
      const ok = server.upgrade(req, { data: { topic, absPath: abs } });
      if (ok) return undefined as unknown as Response;
      return new Response("Upgrade failed", { status: 426 });
    }

    if (path === "/" || path === "/index.html") {
      return Response.redirect(`${url.origin}/modules/index.html`, 302);
    }

    if (path === "/modules.json") {
      return new Response(JSON.stringify(manifestList(), null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
      });
    }

    if (path === "/server/info") {
      return new Response(JSON.stringify({ host: HOST, port: PORT, lan: lanIPs() }), {
        headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
      });
    }

    if (req.method === "PUT") {
      if (path.startsWith("/modules/") || path === "/modules")
        return new Response("Forbidden: cannot write to modules/", { status: 403, headers: CORS });
      if (path === "/server/restart") {
        const body = await req.text();
        const cfg = JSON.parse(body);
        if (cfg.host !== HOST) {
          console.log(`restart requested: host ${cfg.host} (current: ${HOST})`);
          process.env.HOST = cfg.host;
          setTimeout(() => process.kill(process.pid, "SIGHUP"), 100);
        }
        return new Response("OK", { headers: CORS });
      }
      const abs = safePath(path);
      if (!abs) return new Response("Forbidden", { status: 403, headers: CORS });
      const body = await req.text();
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, body);
      const topic = relative(ROOT, abs).replace(/\\/g, "/");
      broadcast(topic, body);
      for (const [id, mod] of modules) {
        if (abs.startsWith(mod.dataDir + "/")) {
          mod._ingest(relative(mod.dataDir, abs).replace(/\\/g, "/"), body);
        }
      }
      return new Response("OK", { headers: CORS });
    }

    if (req.method === "GET" || req.method === "HEAD") {
      const modMatch = path.match(/^\/([^/]+)\/(.+)$/);
      if (modMatch) {
        const [, id, rest] = modMatch;
        const mod = modules.get(id);
        if (mod) {
          const route = mod._route(req.method, rest);
          if (route) return route(req, url);
        }
      }
      const abs = safePath(path);
      if (!abs) return new Response("Forbidden", { status: 403 });
      return serveFile(abs);
    }

    return new Response("Method not allowed", { status: 405, headers: CORS });
  },

  websocket: {
    async open(ws) {
      const { topic, absPath } = ws.data;
      let set = subscribers.get(topic);
      if (!set) subscribers.set(topic, (set = new Set()));
      set.add(ws);
      console.log("+WS", topic, `(${set.size})`);
      try {
        const text = await readFile(absPath, "utf8");
        ws.send(text);
      } catch { /* file not present yet */ }
    },
    async message(ws, msg) {
      const { topic, absPath } = ws.data;
      const text = typeof msg === "string" ? msg : new TextDecoder().decode(msg as Uint8Array);
      await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, text);
      broadcast(topic, text, ws);
      for (const [id, mod] of modules) {
        if (absPath.startsWith(mod.dataDir + "/")) {
          mod._ingest(relative(mod.dataDir, absPath).replace(/\\/g, "/"), text);
        }
      }
    },
    close(ws) {
      const { topic } = ws.data;
      const set = subscribers.get(topic);
      if (!set) return;
      set.delete(ws);
      if (!set.size) subscribers.delete(topic);
      console.log("-WS", topic, `(${set?.size ?? 0})`);
    },
  },
});

console.log(`LenVerse server  http://${server.hostname}:${server.port}/`);
console.log(`  root   ${ROOT}`);
console.log(`  modules: ${[...modules.keys()].join(", ") || "(none)"}`);