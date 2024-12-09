# LenVerse

Just simple lyrics presentation from txt files and setlists.

- Song lyrics are in empty line delimited files in `songs/` directory
- Setlists are in `lists` directory, each line is relative path from `songs/` folder
- In `current/` directory there is currently selected list, songs, songindex, verse, verseindex
- Connect to websocket `ws://127.0.0.1:5005/current/verse.txt` to receive updates on current verse.
- Connecting to any file path `ws://127.0.0.1:5005/<filepath>` server will send updates to that file
- Sending message to websocket, rewrites that filepath
- HTTP `GET /songs/` will list all song files recursively, even from subdirs. Same for `/lists/`
- HTTP `PUT /songs/Amazing Grace.txt` will rewrite that file with request body content, and broadcast new content to connected websocket listeners
- no framework, no json, no sql, just plain good old http server, filesystem, html, js, css
- recognizes OpenLyrics XML, OpenSong XML, INI style txt formats

# Run server

## Go

    cd server-go/
    go mod tidy
    go build server.go
    cd ..
    server-go/server

## NodeJS

    cd server-js/
    npm install
    cd ..
    node server-js/server.js
    
# Python
    
    pip3 install flask flask-sock
    python3 server-py/server.py

# Usage with other software

## OBS

1. Create text source
2. Set it to read current/verse.txt
3. Create Browser Docks for pages `http://127.0.0.1:5005/songs.html`, `/lists.html` and `/lyrics.html`

## Browser

- open http://127.0.0.1:5005/main.html for current verse display
- open http://127.0.0.1:5005/stage.html for stage display

## Others

- Listen to messages on websocket `ws://127.0.0.1:5005/current/verse.txt`
- Poll requests using HTTP GET `http://127.0.0.1:5005/current/verse.txt`

# Todo

- [ ] stage view html
- [ ] mobile layout
- [ ] search in song content
- [ ] button to save setlist
- [ ] custom user js, css
- [ ] parse more song formats
- [ ] drag and drop
- [ ] installable gui app
- [ ] song editor textarea
- [ ] websocket listen to changes on dirs `songs/` and `lists/`
