// HTTP + WebSocket smoke tests for server/server.ts.
//
//   bun test server/tests/server.test.ts
//
// Spins up the server on a random port and runs against the real modules/ and
// data directories, restoring any files it writes to.

import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawn, type Subprocess } from "bun";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const PORT = String(5100 + Math.floor(Math.random() * 400));
const BASE = `http://127.0.0.1:${PORT}`;
const WS   = `ws://127.0.0.1:${PORT}`;

let proc: Subprocess;
const restore = new Map<string, string>();

async function snapshot(rel: string) {
  const p = join(ROOT, rel);
  restore.set(p, await readFile(p, "utf8"));
}

beforeAll(async () => {
  await snapshot("var/song/path.txt");
  await snapshot("var/song/verseindex.txt");

  proc = spawn({
    cmd: ["bun", "server/server.ts"],
    cwd: ROOT,
    env: { ...process.env, PORT, HOST: "127.0.0.1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/modules.json`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await Bun.sleep(50);
  }
  throw new Error("server did not start");
});

afterAll(async () => {
  for (const [p, body] of restore) await writeFile(p, body);
  proc?.kill();
});

test("GET / redirects to /modules/index.html", async () => {
  const r = await fetch(`${BASE}/`, { redirect: "manual" });
  expect(r.status).toBe(302);
  expect(r.headers.get("location")).toContain("/modules/index.html");
});

test("GET /modules.json lists discovered modules", async () => {
  const mods = await (await fetch(`${BASE}/modules.json`)).json();
  const ids = mods.map((m: any) => m.id).sort();
  expect(ids).toContain("song");
  const songs = mods.find((m: any) => m.id === "song");
  expect(songs.dashboard).toBe("dashboard/index.html");
});

test("GET /<path> serves static files from root", async () => {
  const r = await fetch(`${BASE}/modules/shared/lenverse.js`);
  expect(r.status).toBe(200);
  const text = await r.text();
  expect(text).toContain("subscribe");
  expect(text).toContain("Replicant");
});

test("GET /<dir>/ returns directory listing", async () => {
  const r = await fetch(`${BASE}/var/song/`);
  expect(r.status).toBe(200);
  const text = await r.text();
  expect(text).toContain("verseindex.txt");
});

test("GET /modules/<id>/dashboard|graphics serves static files", async () => {
  const r1 = await fetch(`${BASE}/modules/song/dashboard/index.html`);
  expect(r1.status).toBe(200);
  const r2 = await fetch(`${BASE}/modules/song/graphics/verse.html`);
  expect(r2.status).toBe(200);
  const r3 = await fetch(`${BASE}/modules/bible/graphics/main-bible.html`);
  expect(r3.status).toBe(200);
});

test("PUT /<path> writes a file", async () => {
  const body = "put-test-" + Date.now();
  const r = await fetch(`${BASE}/var/song/text.txt`, { method: "PUT", body });
  expect(r.status).toBe(200);
  const got = await (await fetch(`${BASE}/var/song/text.txt`)).text();
  expect(got).toBe(body);
});

test("PUT /modules/<path> is blocked", async () => {
  const r = await fetch(`${BASE}/modules/song/dashboard/index.html`, {
    method: "PUT",
    body: "hacked",
  });
  expect(r.status).toBe(403);
});

test("path traversal is rejected", async () => {
  const r = await fetch(`${BASE}/..%2F..%2Fetc%2Fpasswd`);
  expect(r.status).toBe(403);
});

test("CORS preflight returns 204 with allow headers", async () => {
  const r = await fetch(`${BASE}/var/song/path.txt`, { method: "OPTIONS" });
  expect(r.status).toBe(204);
  expect(r.headers.get("access-control-allow-methods")).toContain("PUT");
});

function openWS(path: string): Promise<{ ws: WebSocket; messages: string[] }> {
  return new Promise((res, rej) => {
    const ws = new WebSocket(WS + path);
    const messages: string[] = [];
    ws.onmessage = (e) => messages.push(typeof e.data === "string" ? e.data : "<bin>");
    ws.onopen = () => res({ ws, messages });
    ws.onerror = (e) => rej(e);
  });
}

test("WS on same path as GET sends current contents on open", async () => {
  const seed = "ws-open-" + Date.now();
  await fetch(`${BASE}/var/song/text.txt`, { method: "PUT", body: seed });
  const { ws, messages } = await openWS("/var/song/text.txt");
  await Bun.sleep(80);
  ws.close();
  expect(messages[0]).toBe(seed);
});

test("WS write broadcasts to other subscribers but not the sender", async () => {
  const a = await openWS("/var/song/text.txt");
  const b = await openWS("/var/song/text.txt");
  await Bun.sleep(60);
  a.messages.length = 0;
  b.messages.length = 0;

  const payload = "from-A-" + Date.now();
  a.ws.send(payload);
  await Bun.sleep(120);

  expect(b.messages).toContain(payload);
  expect(a.messages).not.toContain(payload);
  a.ws.close(); b.ws.close();
});

test("HTTP PUT broadcasts to all WS subscribers", async () => {
  const a = await openWS("/var/song/text.txt");
  const b = await openWS("/var/song/text.txt");
  await Bun.sleep(60);
  a.messages.length = 0;
  b.messages.length = 0;

  const payload = "from-http-" + Date.now();
  await fetch(`${BASE}/var/song/text.txt`, { method: "PUT", body: payload });
  await Bun.sleep(120);

  expect(a.messages).toContain(payload);
  expect(b.messages).toContain(payload);
  a.ws.close(); b.ws.close();
});

test("song/index.ts extension resets verseindex when path changes", async () => {
  await fetch(`${BASE}/var/song/verseindex.txt`, { method: "PUT", body: "7" });
  await Bun.sleep(40);
  expect(await (await fetch(`${BASE}/var/song/verseindex.txt`)).text()).toBe("7");

  await fetch(`${BASE}/var/song/path.txt`, { method: "PUT", body: "Amazing Grace.txt" });
  await Bun.sleep(150);
  expect(await (await fetch(`${BASE}/var/song/verseindex.txt`)).text()).toBe("0");
});