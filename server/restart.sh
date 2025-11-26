#!/bin/bash

# Lenverse Server Restart Script
# Usage: ./restart.sh [options]

set -e

# Default values
SERVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SERVER_DIR")"
SERVER_BINARY="$SERVER_DIR/server-c-mac-arm64"
PID_FILE="$SERVER_DIR/server.pid"
LOG_FILE="$SERVER_DIR/server.log"

# Default base directory (can be overridden by LENVERSE_DIR env var)
export LENVERSE_DIR="${LENVERSE_DIR:-$PROJECT_DIR/www}"

# Parse command line arguments
REBUILD=false
VERBOSE=false
DAEMON=true

while [[ $# -gt 0 ]]; do
    case $1 in
        -r|--rebuild)
            REBUILD=true
            shift
            ;;
        -v|--verbose)
            VERBOSE=true
            DAEMON=false
            shift
            ;;
        -f|--foreground)
            DAEMON=false
            shift
            ;;
        -h|--help)
            echo "Usage: $0 [options]"
            echo "Options:"
            echo "  -r, --rebuild    Rebuild the server before restarting"
            echo "  -v, --verbose    Show verbose output and run in foreground"
            echo "  -f, --foreground Run server in foreground (not daemonized)"
            echo "  -h, --help       Show this help message"
            echo ""
            echo "Environment variables:"
            echo "  LENVERSE_DIR     Base directory to serve (default: \$PROJECT_DIR/www)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Function to log messages
log() {
    if [ "$VERBOSE" = true ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    fi
}

# Function to stop the server
stop_server() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if kill -0 "$pid" 2>/dev/null; then
            log "Stopping server (PID: $pid)..."
            kill "$pid"
            # Wait for graceful shutdown
            local count=0
            while kill -0 "$pid" 2>/dev/null && [ $count -lt 10 ]; do
                sleep 1
                ((count++))
            done
            # Force kill if still running
            if kill -0 "$pid" 2>/dev/null; then
                log "Force killing server..."
                kill -9 "$pid"
            fi
        else
            log "Server PID file exists but process not running"
        fi
        rm -f "$PID_FILE"
    else
        # Try to find and kill any running server processes
        local pids=$(pgrep -f "server-c-mac-arm64" || true)
        if [ -n "$pids" ]; then
            log "Found running server processes: $pids"
            echo "$pids" | xargs kill
            sleep 2
        fi
    fi
}

# Function to rebuild the server
rebuild_server() {
    log "Rebuilding server..."
    cd "$SERVER_DIR"
    gcc -o server-c-mac-arm64 server.c mongoose.c -lpthread -ldl
    if [ $? -eq 0 ]; then
        log "Server rebuilt successfully"
    else
        echo "Error: Failed to rebuild server"
        exit 1
    fi
}

# Function to start the server
start_server() {
    log "Starting server..."
    log "Base directory: $LENVERSE_DIR"
    log "Binary: $SERVER_BINARY"
    
    cd "$SERVER_DIR"
    
    if [ "$DAEMON" = true ]; then
        # Start in background with PID file
        nohup "$SERVER_BINARY" > "$LOG_FILE" 2>&1 &
        local pid=$!
        echo "$pid" > "$PID_FILE"
        log "Server started in background (PID: $pid)"
        log "Log file: $LOG_FILE"
        
        # Wait a moment and check if it's still running
        sleep 2
        if kill -0 "$pid" 2>/dev/null; then
            log "Server is running successfully"
            echo "Server started successfully on http://localhost:5005"
        else
            echo "Error: Server failed to start. Check log file: $LOG_FILE"
            rm -f "$PID_FILE"
            exit 1
        fi
    else
        # Start in foreground
        log "Starting server in foreground..."
        exec "$SERVER_BINARY"
    fi
}

# Main execution
log "Lenverse Server Restart Script"
log "==============================="

# Stop existing server
stop_server

# Rebuild if requested
if [ "$REBUILD" = true ]; then
    rebuild_server
fi

# Start the server
start_server