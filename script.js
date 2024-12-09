function connectToFileWebSocket(path, onUpdateCallback) {
    const ws = new WebSocket(`ws://${window.location.host}${path}`);
    const o = {}

    ws.onopen = () => {
        console.log(`WebSocket connected to ${path}`);
        o.ws = ws;
    };

    if (typeof onUpdateCallback === "function") {
        ws.onmessage = ({data}) => {
            onUpdateCallback(data);
        }
    }

    ws.onclose = () => {
        console.log(`WebSocket connection to ${path} closed`);
        // Reconnect after a delay
        setTimeout(() => connectToFileWebSocket(path, onUpdateCallback), 1000);
        o.send = null;
    };

    ws.onerror = (error) => {
        console.error(`WebSocket error on ${path}:`, error);
    };

    return o;
}

async function GET(path) {
    try {
        const res = await fetch(path);
        if (res.ok) {
            return res.text();
        } else {
            return "";
        }
    } catch (error) {
        console.error("Error GET", path, error);
    }
}

async function PUT(path, body) {
    try {
        await fetch(path, {
            method: "PUT",
            headers: { "Content-Type": "text/plain" },
            body: body,
        });
    } catch (error) {
        console.error("Error PUT", path, error);
    }
}

function handleKeyDown(event) {
    if (event.key === "ArrowUp" && selectedLyricIndex > 0) {
        selectLyric(selectedLyricIndex - 1);
    } else if (event.key === "ArrowDown" && selectedLyricIndex < lyrics.length - 1) {
        selectLyric(selectedLyricIndex + 1);
    } else if (event.key === "H") {
        hideLyric();
    }
}

function parseOpenSongLyrics(s) {
    const verses = {};
    let key = 'V';
    let chords = '';

    s.split('\n').forEach((line) => {
        if (!line) {
            return; // skip empty lines
        } else if (line[0] === '[') { // verse shortcut
            key = line.replace(/[\[\]]/g, '').toUpperCase();
            chords = '';
        } else if (line[0] === '.') { // chords
            chords = line.slice(1) + ' '; // last space is for simple parsing
        } else if (' 123456789'.includes(line[0])) {
            const first = line[0];
            line = line.slice(1).split(''); // convert line to an array
            let offset = 0;
            let chord = null;
            // insert chords into the line
            for (let i = 0; i < chords.length; i++) {
                const c = chords[i];
                if (c !== ' ') {
                    if (chord === null) {
                        chord = '[' + c; // open
                    } else {
                        chord += c; // append
                    }
                } else if (chord) {
                    chord += ']'; // close
                    line.splice(offset, 0, chord);
                    offset += chord.length;
                    chord = null;
                } else {
                    offset += 1; // spaces from the start
                }
            }
            // remove underscores (used for indenting) and squash spaces
            line = line.join('').replace(/_/g, '').replace(/\s+/g, ' ').trim();
            // determine the key for this line
            const lineKey = first !== ' ' ? key + first : key;
            if (!verses[lineKey]) {
                verses[lineKey] = [];
            }
            verses[lineKey].push(line);
        } else if (line[0] === ';') { // comment
            return;
        } else if (line[0] === '|') { // comment with content
            const lineKey = key + (line[0] !== ' ' ? line[0] : '');
            if (!verses[lineKey]) {
                verses[lineKey] = [];
            }
            verses[lineKey].push(line.slice(1));
        } else {
            throw new Error(`Unknown prefix ${line}`);
        }
    });
    for (const [key, lines] of Object.entries(verses)) {
        verses[key] = lines.join('\n');
    }
    return verses;
}

function parseOpenSongXml(xml) {
    const lyricsText = xml.getElementsByTagName("lyrics")[0].textContent.trim();
    const verses = parseOpenSongLyrics(lyricsText);
    const verseOrder = xml.getElementsByTagName("presentation")[0].textContent.trim().toUpperCase().split(/\s+/);
    return { verses, verseOrder };
}

function parseOpenLyricsXml(xml) {
    const ns = "http://openlyrics.info/namespace/2009/song";
    const verseOrder = xml.getElementsByTagNameNS(ns, "verseOrder")[0].textContent.trim().toUpperCase().split(/\s+/);
    const verses = {};
    const verse_array = xml.getElementsByTagNameNS(ns, "verse");
    for (const verse of verse_array) {
        const name = verse.getAttribute("name").toUpperCase();
        verses[name] = verse.getElementsByTagNameNS(ns, "lines")[0].innerHTML;
    }
    return { verses, verseOrder };
}