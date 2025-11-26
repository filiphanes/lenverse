#!/bin/bash

# Go server
GOOS=darwin GOARCH=arm64 go build -ldflags="-s -w" -o ../bin/server-mac-arm64 server.go
#GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o ../bin/server-win-amd64.exe server.go
#GOOS=darwin GOARCH=amd64 go build -ldflags="-s -w" -o ../bin/server-mac-intel server.go
#GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o ../bin/server-linux-amd64 server.go
#GOOS=linux GOARCH=arm64 go build -ldflags="-s -w" -o ../bin/server-linux-arm64 server.go
#GOOS=windows GOARCH=arm64 go build -ldflags="-s -w" -o ../bin/server-win-arm64.exe server.go

# Mako server
#curl -s https://raw.githubusercontent.com/RealTimeLogic/BAS/main/LinuxBuild.sh | bash
#bash BAS/main/LinuxBuild.sh

# Mongoose server
#gcc -O2 -DNDEBUG -o ../bin/serverc-mac-arm64 server.c mongoose.c -pthread
