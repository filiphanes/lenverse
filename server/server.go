package main

import (
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/gorilla/websocket"
)

var (
	baseDir     = "."
	connections = make(map[string][]*websocket.Conn)
	mu          sync.Mutex

	upgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
)

// Serve file lists as plain text
func handleFileList(w http.ResponseWriter, r *http.Request) {
	dir := filepath.Join(baseDir, r.URL.Path)

	entries, err := os.ReadDir(dir)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/plain")
	for _, entry := range entries {
		if entry.IsDir() {
			fmt.Fprintln(w, entry.Name()+"/")
		} else if entry.Name()[0] != '.' {
			fmt.Fprintln(w, entry.Name())
		}
	}
}

// Serve or update a file, or handle WebSocket
func handleFileOrWebSocket(w http.ResponseWriter, r *http.Request) {
	filePath := filepath.Join(baseDir, r.URL.Path)

	// Check if this is a WebSocket upgrade request
	if websocket.IsWebSocketUpgrade(r) {
		log.Println("WS", r.URL.Path)
		handleWebSocket(w, r)
		return
	}
	log.Println(r.Method, r.URL.Path)

	// Otherwise, handle as an HTTP file request
	if r.Method == http.MethodGet {
		if r.URL.Path == "/" {
			filePath = filepath.Join(baseDir, "index.html")
		}

		stat, err := os.Stat(filePath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusNotFound)
			return
		}

		// Handle recursive directory listing
		if stat.IsDir() {
			handleFileList(w, r)
			return
		}

		// Handle reading regular file
		content, err := os.ReadFile(filePath)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		// Map file extensions to content types
		ext := strings.ToLower(filepath.Ext(filePath))
		contentType := mime.TypeByExtension(ext)
		if contentType == "" {
			if ext == ".md" {
				contentType = "text/markdown"
			} else {
				contentType = "application/octet-stream"
			}
		}

		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Write(content)
	} else if r.Method == http.MethodPut {
		// TODO: don't allow writing to any file
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := os.WriteFile(filePath, body, 0644); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		broadcastUpdate(filePath, string(body))
		w.WriteHeader(http.StatusOK)
	}
}

// Handle WebSocket connections
func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	filePath := filepath.Join(baseDir, r.URL.Path)

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	mu.Lock()
	connections[filePath] = append(connections[filePath], conn)
	mu.Unlock()

	// Send current file content as the first message
	content, err := os.ReadFile(filePath)
	if err == nil {
		conn.WriteMessage(websocket.TextMessage, content)
	}

	go func() {
		defer func() {
			conn.Close()
			mu.Lock()
			defer mu.Unlock()
			for i, c := range connections[filePath] {
				if c == conn {
					connections[filePath] = append(connections[filePath][:i], connections[filePath][i+1:]...)
					break
				}
			}
		}()
		for {
			_, message, err := conn.ReadMessage()
			if err != nil {
				break
			}
			if err := os.WriteFile(filePath, message, 0644); err == nil {
				broadcastUpdate(filePath, string(message))
			}
		}
	}()
}

// Broadcast updates to all WebSocket clients
func broadcastUpdate(filePath, content string) {
	mu.Lock()
	defer mu.Unlock()

	for _, conn := range connections[filePath] {
		conn.WriteMessage(websocket.TextMessage, []byte(content))
	}
}

func main() {
	http.HandleFunc("/", handleFileOrWebSocket)
	listen := os.Getenv("LISTEN")
	if len(listen) == 0 {
		listen = "127.0.0.1:5005"
	}

	log.Printf("Listening on http://%s/\n", listen)
	log.Printf("Serving dir '%s'\n", baseDir)
	if err := http.ListenAndServe(listen, nil); err != nil {
		println("Error starting server:", err)
	}
}
