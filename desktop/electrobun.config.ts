import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "LenVerse",
    identifier: "sh.lenverse.desktop",
    version: "0.1.0",
  },
  build: {
    // No webview bundles — the home screen is served by the LenVerse bun
    // server out of modules/index.html. The Electrobun shell only owns the
    // native window and the server child process.
    views: {},
    copy: {
      "../server/server.ts": "server/server.ts",
      "../server/api.ts": "server/api.ts",
      "../modules/index.html": "modules/index.html",
      "../modules/shared/lenverse.css": "modules/shared/lenverse.css",
      "../modules/shared/lenverse.js": "modules/shared/lenverse.js",
    },
    mac:   { bundleCEF: false },
    linux: { bundleCEF: false },
    win:   { bundleCEF: false },
  },
} satisfies ElectrobunConfig;
