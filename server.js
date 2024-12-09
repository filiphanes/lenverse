const express = require("express");
const WebSocket = require("ws");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 5005;

// Base directories for songs and lists
const BASE_DIR = ".";
const SONGS_DIR = path.join(BASE_DIR, "songs");
const LISTS_DIR = path.join(BASE_DIR, "lists");
const CURRENT_DIR = path.join(BASE_DIR, "current");

// WebSocket server
const wss = new WebSocket.Server({ noServer: true });
const connections = {};

// Helper function to list files recursively
function listFilesRecursive(directory) {
    const fileList = [];
    if (fs.existsSync(directory)) {
        fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                fileList.push(...listFilesRecursive(fullPath));
            } else if (entry.isFile()) {
                fileList.push(fullPath);
            }
        });
    }
    return fileList;
}

app.use(express.text({ type: "*/*" }));

app.get("/songs/", (req, res) => {
    res.send(listFilesRecursive(SONGS_DIR).map(p => path.relative(SONGS_DIR, p)).join('\n'));
});

app.get("/lists/", (req, res) => {
    res.send(listFilesRecursive(LISTS_DIR).map(p => path.relative(LISTS_DIR, p)).join('\n'));
});

app.get("/current/", (req, res) => {
    res.send(listFilesRecursive(CURRENT_DIR).map(p => path.relative(CURRENT_DIR, p)).join('\n'));
});

app.put("/:dir/:filePath", (req, res) => {
    const filePath = path.join(BASE_DIR, req.params.dir, req.params.filePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, req.body, "utf-8");
    broadcastFileUpdate(req.params.dir+'/'+req.params.filePath, req.body);
    res.send("Updated");
});

// Serve static files
app.use(express.static(BASE_DIR, {
    dotfiles: "allow",
    etag: false,
}));

// WebSocket handling
function broadcastFileUpdate(filePath, content) {
    if (connections[filePath]) {
        connections[filePath].forEach((ws) => {
            try {
                ws.send(content);
            } catch {
                // Ignore errors
            }
        });
    }
}

wss.on("connection", (ws, filePath) => {
    const fullPath = path.join(BASE_DIR, filePath);

    // Send the current file content as the first message
    if (fs.existsSync(fullPath)) {
        ws.send(fs.readFileSync(fullPath, "utf-8"));
    }

    // Keep track of connections
    if (!connections[filePath]) {
        connections[filePath] = [];
    }
    connections[filePath].push(ws);

    // Handle incoming messages to update the file
    ws.on("message", (message) => {
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, message, "utf-8");
        broadcastFileUpdate(filePath, message.toString());
    });

    ws.on("close", () => {
        connections[filePath] = connections[filePath].filter((conn) => conn !== ws);
        if (connections[filePath].length === 0) {
            delete connections[filePath];
        }
    });
});

// Integrate WebSocket server with Express
const server = app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

server.on("upgrade", (request, socket, head) => {
    const filePath = request.url.substring(1); // Remove leading "/"
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, filePath);
    });
});
