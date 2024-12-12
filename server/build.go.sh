GOOS=linux GOARCH=amd64 go build -o ../server-linux-amd64 server.go 
GOOS=linux GOARCH=arm64 go build -o ../server-linux-arm64 server.go
# GOOS=windows GOARCH=arm64 go build -o ../server-win-arm64.exe server.go
GOOS=windows GOARCH=amd64 go build -o ../server-win-amd64.exe server.go
GOOS=darwin GOARCH=arm64 go build -o ../server-mac-arm64 server.go
GOOS=darwin GOARCH=amd64 go build -o ../server-mac-intel server.go