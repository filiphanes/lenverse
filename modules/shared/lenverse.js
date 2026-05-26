// Shared client helper. Flat-file protocol from server/server.ts:
//   GET /<path>             read once (directories return a newline-delimited listing)
//   PUT /<path>             overwrite + broadcast to WS peers (blocked for modules/**)
//   WS  /<path>             subscribe; server sends current contents on open, then
//                           any subsequent change. WS writes overwrite the file and
//                           fan out to all other subscribers.

const HOST = location.host;
const WS_PROTO = location.protocol === "https:" ? "wss:" : "ws:";

export async function readData(path) {
    const r = await fetch(`/${strip(path)}`);
    if (!r.ok) throw new Error(`GET ${path}: ${r.status}`);
    return r.text();
}

export async function writeData(path, body) {
    const r = await fetch(`/${strip(path)}`, { method: "PUT", body });
    if (!r.ok) throw new Error(`PUT ${path}: ${r.status}`);
}

export function subscribe(path, onUpdate) {
    let ws;
    let alive = true;
    const url = `${WS_PROTO}//${HOST}/${strip(path)}`;
    function connect() {
        ws = new WebSocket(url);
        ws.onopen = () => document.body.classList.add("connected");
        ws.onmessage = (e) => onUpdate?.(e.data);
        ws.onclose = () => {
            document.body.classList.remove("connected");
            if (alive) setTimeout(connect, 1000);
        };
        ws.onerror = () => ws.close();
    }
    connect();
    return {
        write(text) { if (ws?.readyState === 1) ws.send(text); },
        close() { alive = false; ws?.close(); },
    };
}

// Module-scoped Replicant: connects WS to /var/<moduleId>/<name>.txt.
//   const r = Replicant("song", "verseindex");
//   r.on("change", v => ...);
//   r.value = "new";   // writes + broadcasts
export function Replicant(moduleId, name) {
    const path = `var/${moduleId}/${name}.txt`;
    const listeners = new Set();
    let current;
    const sub = subscribe(path, (v) => {
        current = v;
        for (const fn of listeners) fn(v);
    });
    return {
        path,
        name,
        get value() { return current; },
        set value(v) { sub.write(v); },
        on(event, fn) { if (event === "change") listeners.add(fn); },
        off(event, fn) { if (event === "change") listeners.delete(fn); },
        close() { sub.close(); },
    };
}

export async function listModules() {
    const r = await fetch("/modules.json");
    return r.json();
}

function strip(p) {
    return String(p).replace(/^\/+/, "");
}