cd server
GOOS=darwin GOARCH=arm64 go build -o ../server-mac-arm64 server.go
cd ..; exit
GOOS=darwin GOARCH=amd64 go build -o ../server-mac-intel server.go
GOOS=linux GOARCH=amd64 go build -o ../server-linux-amd64 server.go 
GOOS=linux GOARCH=arm64 go build -o ../server-linux-arm64 server.go
# GOOS=windows GOARCH=arm64 go build -o ../server-win-arm64.exe server.go
GOOS=windows GOARCH=amd64 go build -o ../server-win-amd64.exe server.go
cd ../clients/resolume
GOOS=darwin GOARCH=arm64 go build -o ../arena-mac-arm64 arena.go
GOOS=windows GOARCH=amd64 go build -o ../arena-win-amd64.exe arena.go
cd ../..

zip -r lenverse-0.2.0.zip \
    songs/* \
    lists/* \
    current/* \
    index.html \
    biblia.html \
    songs.html \
    lists.html \
    verses.html \
    editor.html \
    full.html \
    main.html \
    script.js \
    stage.html \
    style.css \
    server-* \
    README.md \
    favicon.png
