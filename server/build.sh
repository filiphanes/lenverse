#!/bin/bash

# Go server
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o go-mac-arm64 server.go
#GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o go-win-amd64.exe server.go
#GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o go-mac-intel server.go
#GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o go-linux-amd64 server.go
#GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o go-linux-arm64 server.go
#GOOS=windows GOARCH=arm64 go build -ldflags="-s -w" -o go-win-arm64.exe server.go

# Mako server
#curl -s https://raw.githubusercontent.com/RealTimeLogic/BAS/main/LinuxBuild.sh | bash
#bash BAS/main/LinuxBuild.sh

# Mongoose server
gcc -O2 -DNDEBUG -o c-mac-arm64 server.c mongoose.c -pthread
