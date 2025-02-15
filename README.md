# LenVerse

Just simple presentation from txt files and setlists.

- Song verses are in empty line delimited files in `songs/` directory or OpenLyrics xml, OpenSong xml, ProPresenter API JSON
- Setlists are in `lists` directory, each line is relative path from `songs/` folder
- In `current/` directory there is currently selected list, songs, songindex, verse, verseindex
- Connect to websocket `ws://127.0.0.1:5005/current/verse.txt` to receive updates on current verse.
- Connecting to any file path `ws://127.0.0.1:5005/<filepath>` server will send updates to that file
- Sending message to websocket, rewrites that filepath
- HTTP `GET /songs/` will list all song files recursively, even from subdirs. Same for `/lists/`
- HTTP `PUT /songs/Amazing Grace.txt` will rewrite that file with request body content, and broadcast new content to connected websocket listeners
- no framework, no sql, just plain good old http server, filesystem, html, js, css
- search in song content
- simple rich text editor
- timer using semantic [&lt;time&gt; tag](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/time), support period and time format in datetime

# Run server

## Go

    cd server-go/
    go mod tidy
    go build server.go
    server/server
    # or using custom LISTEN address and port, default is 127.0.0.1:5005
    LISTEN=0.0.0.0:8080 server/server

## NodeJS

    cd server/
    npm install
    node server.js
    
# Python
    
    cd server/
    pip3 install flask flask-sock
    python3 server.py

# Usage with other software

## OBS

1. Create text source
2. Set it to read current/verse.txt
3. Create Browser Docks for pages `http://127.0.0.1:5005/songs.html`, `/lists.html` and `/verses.html`

## Browser

- open http://127.0.0.1:5005/main.html for current verse display
- open http://127.0.0.1:5005/stage.html for stage display
- open http://127.0.0.1:5005/full.html for multi-field display

## Others

- Listen to messages on websocket `ws://127.0.0.1:5005/current/verse.txt`
- Poll requests using HTTP GET `http://127.0.0.1:5005/current/verse.txt`

# Todo

- [ ] mobile layout
- [ ] parse more song formats
- [ ] installable gui app
- [ ] watch filesystem changes and broadcast them to ws clients
- [ ] websocket listen to changes on dirs `songs/` and `lists/`
