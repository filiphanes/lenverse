HOST = window.location.host;

function connectToFileWebSocket(path, onUpdateCallback) {
	let ws;
	function reconnect() {
		ws = new WebSocket(`ws://${HOST}${path}`);
		ws.onopen = () => {
			console.log("WebSocket connected to", path);
		};

		if (typeof onUpdateCallback === "function") {
			ws.onmessage = ({ data }) => {
				onUpdateCallback(data);
			}
		}

		ws.onclose = () => {
			console.log("WebSocket connection to ", path, "closed");
			setTimeout(reconnect, 1000);
		};

		ws.onerror = (error) => {
			console.error(`WebSocket error on ${path}:`, error);
		};
	}
	reconnect();

	return function updateFileWS(text) {
		return ws.send(text);
	};
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

function appendButton(parent, content, onclick) {
	let button = document.createElement("button");
	button.innerHTML = content;
	button.onclick = onclick;
	parent.appendChild(button);
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
	const verseOrder = xml.getElementsByTagName("presentation")[0].textContent.trim().toUpperCase().split(/\s+/);
	const raw = xml.getElementsByTagName("lyrics")[0].textContent.trim();
	const verses = parseOpenSongLyrics(raw);
	return { verses, verseOrder };
}

function parseOpenLyricsXml(xml) {
	const ns = "http://openlyrics.info/namespace/2009/song";
	const verseOrder = xml.getElementsByTagNameNS(ns, "verseOrder")[0].textContent.trim().toUpperCase().split(/\s+/);
	const fillVerseOrder = (verseOrder.length == 0);
	const verses = {};
	const verse_array = xml.getElementsByTagNameNS(ns, "verse");
	for (const verse of verse_array) {
		const name = verse.getAttribute("name").toUpperCase();
		verses[name] = verse.getElementsByTagNameNS(ns, "lines")[0].innerHTML;
		if (fillVerseOrder) {
			verseOrder.push(name);
		}
	}
	return { verses, verseOrder };
}

function parseMarkdown(md) {
	const verses = {};
	const verseOrder = [];
	let lines = [];
	let name = "";
	for (let line of md.split('\n')) {
		if (line.startsWith('#')) {
			if (name && lines.length) {
				verses[name] = lines.join('\n');
				lines = [];
			}
			name = line.slice(1).trim();
			if (name.length) verseOrder.push(name);
			else name = "";
			continue;
		} else if (line.startsWith('>')) { // Comment as markdown quote
			line = `<span class="comment">${line.slice(1).trim()}</span>`;
		} else { // Chords
			line = line.replace(/\[([^\]]+)\]/g, '<span class="chord">$1</span>');
		}
		if (line.trim()) {
			lines.push(line);
		}
	}
	return { verses, verseOrder };
}

function parseSong(data) {
	if (data.startsWith("<?xml ")) {
		const parser = new DOMParser();
		const xml = parser.parseFromString(data, "application/xml");
		let parsed = {};
		try {
			parsed = parseOpenLyricsXml(xml);
			console.log('Parsed as OpenLyrics XML');
		} catch (error) {
			console.error(error);
		}
		if (!parsed.verses.length) {
			parsed = parseOpenSongXml(xml);
			console.log('Parsed as OpenSong XML');
		}
	} else {
		parsed = parseMarkdown(data);
		console.log('Parsed as Markdown');
	}
	console.log("Parsed song", parsed);
	if (parsed.verseOrder.length) {
		console.log('Parsing as empty-line delimited blocks');
		return parsed.verseOrder.map(key => (`${parsed.verses[key] || ""}<span class="verse">${key}</span>`))
	}
	return data.split(/\n\s*\n/) // Split by empty lines and replace [name] with span.verse
		.map(verse => verse.replace(/^\[([^\]]+)\]\s+/, '<span class="verse">$1</span>'))
}
