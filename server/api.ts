// Module extension API — NodeCG-style.
//
//   import type { Module } from "../../server/api";
//   export default (nodecg: Module) => {
//     const songpath   = nodecg.Replicant("songpath",   { defaultValue: "" });
//     const verseindex = nodecg.Replicant("verseindex", { defaultValue: "0" });
//     songpath.on("change", (now) => { verseindex.value = "0"; });
//
//     nodecg.mount("GET", "search", async (req, url) => new Response("..."));
//   };
//
// Replicant("name") → file at var/<id>/<name>.txt.
// The Module is the only thing extensions touch.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

export type RouteHandler = (req: Request, url: URL) => Response | Promise<Response>;
export type ChangeListener<T> = (newValue: T, oldValue: T | undefined) => void;

export interface ReplicantOptions<T> {
  defaultValue?: T;
  parse?: (raw: string) => T;
  serialize?: (value: T) => string;
}

export interface Replicant<T = string> {
  readonly name: string;
  readonly ready: Promise<void>;
  value: T;
  on(event: "change", fn: ChangeListener<T>): void;
  off(event: "change", fn: ChangeListener<T>): void;
}

export interface Manifest {
  name?: string;
  description?: string;
  version?: string;
  dashboard?: string;
  graphics?: string;
  state?: Record<string, string>;
  [k: string]: unknown;
}

export interface ModuleHost {
  writeData(id: string, sub: string, body: string): Promise<void>;
  broadcast(id: string, sub: string, body: string): void;
  resolveData(id: string, sub: string): string | null;
}

export class Module {
  readonly id: string;
  readonly manifest: Manifest;
  readonly dataDir: string;
  readonly codeDir: string;
  readonly log = console;

  // replicant key = "<name>.txt" → set of ReplicantImpl
  private readonly replicants = new Map<string, Set<ReplicantImpl<any>>>();
  private readonly routes = new Map<string, RouteHandler>();

  constructor(opts: {
    id: string;
    manifest: Manifest;
    dataDir: string;
    codeDir: string;
    host: ModuleHost;
  }) {
    this.id = opts.id;
    this.manifest = opts.manifest;
    this.dataDir = opts.dataDir;
    this.codeDir = opts.codeDir;
    this._host = opts.host;
  }

  /** Create or fetch the named Replicant. File: var/<id>/<name>.txt */
  Replicant<T = string>(name: string, opts: ReplicantOptions<T> = {}): Replicant<T> {
    const key = `${name}.txt`;
    const set = this.replicants.get(key);
    if (set && set.size) {
      for (const r of set) return r as ReplicantImpl<T>;
    }
    const r = new ReplicantImpl<T>(this, key, opts);
    if (!this.replicants.has(key)) this.replicants.set(key, new Set());
    this.replicants.get(key)!.add(r);
    return r;
  }

  mount(method: string, subpath: string, handler: RouteHandler): void {
    const key = `${method.toUpperCase()} ${subpath.replace(/^\/+/, "")}`;
    this.routes.set(key, handler);
  }

  _host: ModuleHost;

  _route(method: string, subpath: string): RouteHandler | undefined {
    return this.routes.get(`${method.toUpperCase()} ${subpath.replace(/^\/+/, "")}`);
  }

  /** Called by server when a data file under this module's dataDir changes. */
  _ingest(filename: string, body: string): void {
    const set = this.replicants.get(filename);
    if (!set) return;
    for (const r of set) r._ingest(body);
  }

  /** Resolve a relative path inside this module's data dir. */
  resolve(sub: string): string {
    const norm = sub.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
    const abs = resolve(this.dataDir, norm);
    const rel = relative(this.dataDir, abs);
    if (rel.startsWith("..") || resolve(this.dataDir, rel) !== abs) {
      throw new Error(`Forbidden path: ${sub}`);
    }
    return abs;
  }

  async read(sub: string): Promise<string> {
    return readFile(this.resolve(sub), "utf8");
  }

  async write(sub: string, body: string): Promise<void> {
    return this._host.writeData(this.id, sub.replace(/^\/+/, "").replace(/\/{2,}/g, "/"), body);
  }
}

class ReplicantImpl<T> implements Replicant<T> {
  readonly name: string;
  readonly ready: Promise<void>;
  private _value!: T;
  private listeners = new Set<ChangeListener<T>>();
  private parse: (raw: string) => T;
  private serialize: (v: T) => string;

  constructor(private mod: Module, private key: string, opts: ReplicantOptions<T>) {
    this.name = key;
    this.parse     = opts.parse     ?? ((raw) => raw as unknown as T);
    this.serialize = opts.serialize ?? ((v)   => v   as unknown as string);

    const def = "defaultValue" in opts ? (opts.defaultValue as T) : (undefined as unknown as T);
    this._value = def;

    this.ready = (async () => {
      try {
        const text = await mod.read(key);
        this._set(this.parse(text), true, false);
      } catch {
        if ("defaultValue" in opts) {
          await mod.write(key, this.serialize(def));
        }
      }
    })();
  }

  get value(): T { return this._value; }
  set value(v: T) {
    void this.mod.write(this.key, this.serialize(v));
  }

  on(event: "change", fn: ChangeListener<T>): void {
    if (event !== "change") return;
    this.listeners.add(fn);
  }
  off(event: "change", fn: ChangeListener<T>): void {
    this.listeners.delete(fn);
  }

  _ingest(raw: string): void {
    const next = this.parse(raw);
    if (shallowEqual(next, this._value)) return;
    this._set(next, true, false);
  }

  private _set(next: T, emit: boolean, _persist: boolean): void {
    const prev = this._value;
    this._value = next;
    if (emit) for (const fn of this.listeners) fn(next, prev);
  }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  try { return JSON.stringify(a) === JSON.stringify(b); }
  catch { return false; }
}