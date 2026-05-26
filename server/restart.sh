#!/bin/bash
cd "$(dirname "$0")"
export LENVERSE_DIR="${LENVERSE_DIR:-$(dirname "$PWD")}"
pkill -f server-c-mac-arm64 2>/dev/null || true
gcc -o server-c-mac-arm64 server.c mongoose.c -lpthread -ldl
nohup ./server-c-mac-arm64 > server.log 2>&1 &
echo $! > server.pid
echo "Server restarted on http://localhost:5005"