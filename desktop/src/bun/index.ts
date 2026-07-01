// LenVerse desktop shell.
//
// Spawns the bun file/WS server as a child process, waits for it to bind,
// then opens a native window onto the song dashboard. Dashboards and graphics
// are reachable through the native system menu (built below) rather than the
// HTML nav bar — that nav bar stays on the home screen for browser clients.

import { BrowserWindow, ApplicationMenu, Utils, type ApplicationMenuItemConfig } from "electrobun/bun";
import { spawn, type Subprocess } from "bun";
import { resolve, dirname, join } from "node:path";
import { readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

const HOST = process.env.LENVERSE_HOST ?? "127.0.0.1";
const PORT = process.env.LENVERSE_PORT ?? "5005";
const URL  = `http://${HOST}:${PORT}/`;

// The window opens straight onto the song dashboard; dashboards and graphics
// are listed in the native system menu (see buildMenu) instead of the HTML nav.
const DEFAULT_VIEW = "modules/song/dashboard/index.html";

const BUNDLED_SERVER = resolve(import.meta.dir, "../server/server.ts");
const BUNDLED = existsSync(BUNDLED_SERVER);

let SERVER: string;
let DATA_DIR: string;
let MODULES_DIR: string;

if (BUNDLED) {
  SERVER = BUNDLED_SERVER;
  DATA_DIR = process.env.LENVERSE_DIR || join(homedir(), "LenVerse");
  MODULES_DIR = join(DATA_DIR, "modules");
} else {
  function findRepoRoot(): string {
    if (process.env.LENVERSE_DIR) return process.env.LENVERSE_DIR;
    let dir = import.meta.dir;
    for (let i = 0; i < 20; i++) {
      if (existsSync(resolve(dir, "server", "server.ts"))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    throw new Error("Cannot find repo root (server/server.ts not found). Set LENVERSE_DIR.");
  }
  const REPO = findRepoRoot();
  SERVER = resolve(REPO, "server", "server.ts");
  DATA_DIR = REPO;
  MODULES_DIR = resolve(REPO, "modules");
}

let server: Subprocess | null = null;

async function startServer() {
  if (BUNDLED) await mkdir(MODULES_DIR, { recursive: true });

  server = spawn({
    cmd: [process.execPath, SERVER],
    cwd: dirname(SERVER),
    env: { ...process.env, HOST, PORT, LENVERSE_DIR: DATA_DIR },
    stdout: "inherit",
    stderr: "inherit",
  });

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${URL}modules.json`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await Bun.sleep(50);
  }
  throw new Error(`LenVerse server did not start at ${URL}`);
}

function stopServer() {
  if (!server) return;
  try { server.kill(); } catch {}
  server = null;
}

async function buildMenu() {
  const mods = await (await fetch(`${URL}modules.json`)).json();
  let info: { host: string; port: string; lan: string[] };
  try { info = await (await fetch(`${URL}server/info`)).json(); } catch { info = { host: HOST, port: PORT, lan: [] }; }

  const moduleMenus: ApplicationMenuItemConfig[] = [];
  for (const m of mods) {
    const dashItems: ApplicationMenuItemConfig[] = [];
    const gfxItems: ApplicationMenuItemConfig[] = [];

    try {
      const files = (await readdir(resolve(MODULES_DIR, m.id, "dashboard")))
        .filter(f => f.endsWith(".html")).sort();
      for (const f of files) {
        dashItems.push({
          label: f.replace(/\.html$/, ""),
          action: "navigate",
          data: `/modules/${m.id}/dashboard/${f}`,
        });
      }
    } catch {}

    try {
      const files = (await readdir(resolve(MODULES_DIR, m.id, "graphics")))
        .filter(f => f.endsWith(".html")).sort();
      for (const f of files) {
        gfxItems.push({
          label: f.replace(/\.html$/, ""),
          action: "navigate",
          data: `/modules/${m.id}/graphics/${f}`,
        });
      }
    } catch {}

    const submenu: ApplicationMenuItemConfig[] = [...dashItems];
    if (dashItems.length > 0 && gfxItems.length > 0) {
      submenu.push({ type: "divider" });
    }
    submenu.push(...gfxItems);

    if (submenu.length > 0) {
      moduleMenus.push({
        label: m.name ?? m.id,
        submenu,
      });
    }
  }

  const serverItems: ApplicationMenuItemConfig[] = [
    { label: `http://${info.host === "0.0.0.0" ? "127.0.0.1" : info.host}:${info.port}`, action: "copy-url" },
  ];
  for (const ip of info.lan) {
    serverItems.push({ label: `http://${ip}:${info.port}`, action: "copy-url", data: `http://${ip}:${info.port}/` });
  }

  ApplicationMenu.setApplicationMenu([
    {
      label: "LenVerse",
      submenu: [
        { role: "about" },
        { type: "divider" },
        { role: "quit", accelerator: "Cmd+Q" },
      ],
    },
    {
      label: "Server",
      submenu: serverItems,
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo", accelerator: "Cmd+Z" },
        { role: "redo", accelerator: "Shift+Cmd+Z" },
        { type: "divider" },
        { role: "cut", accelerator: "Cmd+X" },
        { role: "copy", accelerator: "Cmd+C" },
        { role: "paste", accelerator: "Cmd+V" },
        { role: "selectAll", accelerator: "Cmd+A" },
      ],
    },
    ...moduleMenus,
  ]);
}

process.on("SIGINT",  () => { stopServer(); process.exit(0); });
process.on("SIGTERM", () => { stopServer(); process.exit(0); });
process.on("exit",    stopServer);

await startServer();

const win = new BrowserWindow({
  title: "LenVerse",
  url: `${URL}${DEFAULT_VIEW}`,
  frame: { width: 1200, height: 800, x: 200, y: 120 },
});

ApplicationMenu.on("application-menu-clicked", (event: any) => {
  const { action, data } = event.data;
  if (action === "navigate" && data) {
    win.webview.loadURL(`${URL}${String(data).replace(/^\//, "")}`);
  } else if (action === "copy-url") {
    Utils.clipboardWriteText(data ?? URL);
  }
});

await buildMenu();
console.log(`LenVerse desktop window opened on ${URL}`);