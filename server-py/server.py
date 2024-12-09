from flask import Flask, request, send_from_directory
from flask_sock import Sock
import os

app = Flask(__name__)
sock = Sock(app)

BASE_DIR = "."
connections = {}

def list_files_recursive(directory):
    """Recursively list all files in a directory."""
    file_list = []
    for root, _, files in os.walk(directory):
        for file in files:
            relative_path = os.path.relpath(os.path.join(root, file), directory)
            file_list.append(relative_path)
    return file_list

@app.route("/", defaults={"path": "index.html"})
@app.route("/<path:path>")
def serve_file(path):
    return send_from_directory(BASE_DIR, path)

@app.route("/songs/", methods=["GET"])
@app.route("/lists/", methods=["GET"])
@app.route("/current/", methods=["GET"])
def list_files():
    directory = "songs" if request.path.startswith("/songs/") else "lists"
    full_path = os.path.join(BASE_DIR, directory)
    if os.path.exists(full_path):
        return "\n".join(list_files_recursive(full_path)), 200
    return "", 200

@app.route("/songs/<path:file_path>", methods=["GET", "PUT"])
@app.route("/lists/<path:file_path>", methods=["GET", "PUT"])
@app.route("/current/<path:file_path>", methods=["GET", "PUT"])
def handle_file(file_path):
    full_path = os.path.join(BASE_DIR, file_path)
    if request.method == "GET":
        if os.path.exists(full_path):
            with open(full_path, "r", encoding="utf-8") as f:
                return f.read(), 200, {"Content-Type": "text/plain"}
        return "", 404

    if request.method == "PUT":
        content = request.data.decode("utf-8")
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        broadcast_file(file_path, content)
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
        return "Updated", 200

def broadcast_file(file_path, content):
    for ws in connections.get(file_path, []):
        try:
            ws.send(content)
        except Exception:
            pass

@sock.route("/<path:file_path>")
def file_websocket(ws, file_path):
    full_path = os.path.join(BASE_DIR, file_path)
    if file_path not in connections:
        connections[file_path] = []
    connections[file_path].append(ws)

    # Send the current file content as the first message
    if os.path.exists(full_path):
        with open(full_path, "r", encoding="utf-8") as f:
            ws.send(f.read())

    try:
        while not ws.closed:
            message = ws.receive()
            if message and (file_path.startswith("/songs/") or file_path.startswith("/lists/")):
                # Write received message to the file
                os.makedirs(os.path.dirname(full_path), exist_ok=True)
                with open(full_path, "w", encoding="utf-8") as f:
                    f.write(message)
                # Broadcast updated content to all WebSocket clients
                broadcast_file(file_path, message)
    except:
        pass
    finally:
        connections[file_path].remove(ws)
        if not connections[file_path]:
            del connections[file_path]

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5005)
