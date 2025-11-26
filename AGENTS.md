# Lenverse Agent Guidelines

## Build Commands
- **Main build**: `bash build.sh` (builds server and creates distributable zip)
- **Server only**: `cd server && bash build.sh`
- **Cross-platform**: Builds for darwin/arm64, windows/amd64, linux/amd64

## Code Style
- human readable, avoid dependencies
- **Go**: Standard gofmt, package main for executables, use gorilla/websocket
- **JavaScript**: ES6+ modules, WebSocket connections with auto-reconnect

## File structure
- www/ for static files served over HTTP
- server/ for server implementations
- apps/ for integrations
- bin/ for compiled servers
- / root for configs, .env

## Testing
- No formal test framework detected
- Manual testing via web interface at localhost
- Test WebSocket connections and file serving

## Key Patterns
- Minimalist, elegant, readable, hackable, extendable code philosophy
- WebSocket real-time pub/sub on files, listening on changes
- File-based content management (verses, songs, slide lists)
- Static file serving with dynamic WebSocket updates
- App state is stored in files
- Fast changing small states are in www/var/ folder

## Server
- GET reads file
- PUT writes file
- WebSocket receives file contents on connect, then any change via WS write or HTTP PUT
- WebSocket write writes to file and broadcasts update to clients listening on that file

## App
- Presentation of slides of lyrics, bible verses, images
- Control of various timers: until, since, clock
- Control of web overlays in various display layouts (stage, audience, live-stream)

