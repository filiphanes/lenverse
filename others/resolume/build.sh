#!/bin/bash
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o ../bin/arena-mac-arm64 arena.go
GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o ../bin/arena-win-amd64.exe arena.go
