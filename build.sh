cd server
GOOS=linux GOARCH=amd64 go build -o ../server-linux-amd64 server.go 
GOOS=linux GOARCH=arm64 go build -o ../server-linux-arm64 server.go
# GOOS=windows GOARCH=arm64 go build -o ../server-win-arm64.exe server.go
GOOS=windows GOARCH=amd64 go build -o ../server-win-amd64.exe server.go
GOOS=darwin GOARCH=arm64 go build -o ../server-mac-arm64 server.go
GOOS=darwin GOARCH=amd64 go build -o ../server-mac-intel server.go
cd ..
zip -r lenverse-0.1.0.zip \
    songs/* \
    lists/* \
    current/* \
    index.html \
    songs.html \
    lists.html \
    verses.html \
    main.html \
    README.md \
    script.js \
    stage.html \
    style.css \
    server-* \
    favicon.png
