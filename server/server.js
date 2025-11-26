const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const mime = require("mime-types");

const baseDir = ".";
const LISTEN = process.env.LISTEN || "127.0.0.1:5005";
const connections = {};

const server = http.createServer((req, res) => {
  const urlPath = decodeURI(req.url);
  const filePath = path.join(baseDir, urlPath === "/" ? "index.html" : urlPath.slice(1));
  const method = req.method;
  console.log(req.method, req.url);

  // Handle OPTIONS for CORS
  if (method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // Handle directory listing
  if (method === "GET" && filePath.endsWith("/")) {
    try {
      const entries = fs.readdirSync(filePath, { withFileTypes: true });
      res.writeHead(200, { "Content-Type": "text/plain" });
      entries.forEach(entry => {
        if (entry.isDirectory()) {
          res.write(entry.name + "/\n");
        } else if (entry.name[0] !== ".") {
          res.write(entry.name + "\n");
        }
      });
      res.end();
      return;
    } catch (err) {
      res.writeHead(500);
      res.end(err.message);
      return;
    }
  }

  // Handle GET for files
  if (method === "GET") {
    try {
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        // Redirect if glob matches (mimics Go's filepath.Glob)
        const matches = globMatch(filePath);
        if (matches.length > 0) {
          res.writeHead(302, { Location: "/" + matches[0] });
          res.end();
          return;
        }
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const content = fs.readFileSync(filePath);
      let contentType = mime.lookup(filePath) || "application/octet-stream";
      if (path.extname(filePath).toLowerCase() === ".md") {
        contentType = "text/markdown";
      }
      res.writeHead(200, {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(content);
    } catch (err) {
      res.writeHead(404);
      res.end(err.message);
      console.log(err);
    }
    return;
  }

  // Handle PUT for file updates
  if (method === "PUT") {
    let body = "";
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, body, { mode: 0o644 });
        broadcastUpdate(filePath, body);
        res.writeHead(200, { "Access-Control-Allow-Origin": "*" });
        res.end();
      } catch (err) {
        res.writeHead(500);
        res.end(err.message);
        console.log(err);
      }
    });
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

// WebSocket server
const wss = new WebSocket.Server({ noServer: true });

wss.on("connection", (ws, filePath) => {
  console.log("+WS", filePath);
  const fullPath = path.join(baseDir, filePath);

  // Send current file content
  try {
    if (fs.existsSync(fullPath)) {
      ws.send(fs.readFileSync(fullPath, "utf-8"));
    }
  } catch (err) {
    console.log(err)
  }

  // Store connection
  if (!connections[filePath]) {
    connections[filePath] = [];
  }
  connections[filePath].push(ws);

  // Handle messages
  ws.on("message", message => {
    try {
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, message, { mode: 0o644 });
      broadcastUpdate(filePath, message.toString());
    } catch (err) {
      // Ignore errors
    }
  });

  // Handle close
  ws.on("close", () => {
    console.log("-WS", filePath);
    connections[filePath] = connections[filePath].filter(conn => conn !== ws);
    if (connections[filePath].length === 0) {
      delete connections[filePath];
    }
  });
});

// Broadcast updates to WebSocket clients
function broadcastUpdate(filePath, content) {
  if (connections[filePath]) {
    connections[filePath].forEach(conn => {
      try {
        conn.send(content);
      } catch {
        // Ignore errors
      }
      });
  }
}

// Simple glob-like matching for file paths
function globMatch(pattern) {
  try {
    const dir = path.dirname(pattern);
    const base = path.basename(pattern);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isFile() && entry.name.startsWith(base))
      .map(entry => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

// Handle WebSocket upgrades
server.on("upgrade", (request, socket, head) => {
  const filePath = decodeURI(request.url).substring(1);
  wss.handleUpgrade(request, socket, head, ws => {
    wss.emit("connection", ws, filePath);
  });
});

// Start server
const [host, port] = LISTEN.split(':');
server.listen({host, port}, () => {
  const absolutePath = path.resolve(baseDir);
  console.log(`Listening on http://${host}:${port}/`);
  console.log(`Serving from ${absolutePath}`);
});

