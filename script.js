HOST = window.location.host;

function connectToFileWebSocket(path, onUpdateCallback) {
	let ws;
	function reconnect() {
		ws = new WebSocket(`ws://${HOST}${path}`);
		ws.onopen = () => {
			console.log("WebSocket connected to", path);
			document.body.classList.add("connected")
		};

		if (typeof onUpdateCallback === "function") {
			ws.onmessage = ({ data }) => {
				onUpdateCallback(data);
			}
		}

		ws.onclose = () => {
			console.log("WebSocket connection to ", path, "closed");
			setTimeout(reconnect, 1000);
			document.body.classList.remove("connected")
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
	if (verseOrder.length) {
		return verseOrder.map(name => (`<h1>${name}</h1><p>${verses[name] || ""}</p>`))
	}
}

function parseOpenSongXml(xml) {
	const verseOrder = xml.getElementsByTagName("presentation")[0].textContent.trim().toUpperCase().split(/\s+/);
	const raw = xml.getElementsByTagName("lyrics")[0].textContent.trim();
	const verses = parseOpenSongLyrics(raw);
	if (verseOrder.length) {
		return verseOrder.map(name => (`<h1>${name}</h1><p>${verses[name] || ""}</p>`))
	}
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
	if (verseOrder.length) {
		return verseOrder.map(name => (`<h1>${name}</h1><p>${verses[name] || ""}</p>`))
	}
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
			line = `<blockquote>${line.slice(1).trim()}<blockquote>`;
		} else { // Chords
			line = line.replace(/\[([^\]]+)\]/g, '<sup>$1<sup>');
		}
		if (line.trim()) {
			lines.push(line);
		}
	}
	if (lines.length) verses[name] = lines.join('\n');
	if (name.length)  verseOrder.push(name);
	if (verseOrder.length) {
		return verseOrder.map(name => (`<h1>${name}</h1><p>${verses[name] || ""}</p>`))
	}
}

function parseProJson(data) {
	const verses = [];
	for (let group of data.presentation.groups) {
		for (let slide of group.slides) {
			if (slide.enabled === false) continue;
			const fields = slide.text.split('\r');
			let verse = slide.label ? `<h1>${slide.label}</h1>\n` : "";
			if (slide.notes) verse += `<blockquote>${slide.notes}</blockquote>\n`
			if (slide.name) verse += `<h2>${slide.name}</h2>\n`
			for (let i=1; i <= fields.length; i++) {
				verse += `<p>${fields[i-1]}</p>\n`
			}
			verses.push(verse);
		}
	}
	return verses;
}

function parseText(data) {
	// Split by empty lines and replace [name] with h1
	return data
		.split(/\n\s*\n/)
		.map(verse => verse.replace(/^\[([^\]]+)\]\s+/, '<h1>$1</h1>'))
}

async function parseSong(filename, raw) {
	if (!filename) return [];
	if (!raw) raw = await GET('/songs/'+filename);
	if (raw.startsWith("<?xml ")) {
		const parser = new DOMParser();
		const xml = parser.parseFromString(raw, "application/xml");
		let verses = [];
		try {
			verses = parseOpenLyricsXml(xml);
			console.log('Parsed as OpenLyrics XML');
		} catch (error) {
			console.error(error);
		}
		if (!verses.verses.length) {
			verses = parseOpenSongXml(xml);
			console.log('Parsed as OpenSong XML');
		}
	} else if (filename.endsWith('.md')) {
		verses = parseMarkdown(raw);
		console.log('Parsed as Markdown');
	} else if (filename.endsWith('.json')) {
		const o = JSON.parse(raw);
		verses = parseProJson(o);
		console.log('Parsed as ProJson');
	} else {
		verses = parseText(raw);
		console.log('Parsed as Text');
	}
	console.log("Parsed verses", verses);
	return verses;
}

function normalizeText(text) {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "") // Remove diacritics
		.toLowerCase()
}

// Timers
function formatDate(date, format, utc) {
	var MMMM = ["\x00", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
	var MMM = ["\x01", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	var dddd = ["\x02", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
	var ddd = ["\x03", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

	function ii(i, len) {
		var s = i + "";
		len = len || 2;
		while (s.length < len) s = "0" + s;
		return s;
	}

	var y = utc ? date.getUTCFullYear() : date.getFullYear();
	format = format.replace(/(^|[^\\])yyyy+/g, "$1" + y);
	format = format.replace(/(^|[^\\])yy/g, "$1" + y.toString().substr(2, 2));
	format = format.replace(/(^|[^\\])y/g, "$1" + y);

	var M = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
	format = format.replace(/(^|[^\\])MMMM+/g, "$1" + MMMM[0]);
	format = format.replace(/(^|[^\\])MMM/g, "$1" + MMM[0]);
	format = format.replace(/(^|[^\\])MM/g, "$1" + ii(M));
	format = format.replace(/(^|[^\\])M/g, "$1" + M);

	var d = utc ? date.getUTCDate() : date.getDate();
	format = format.replace(/(^|[^\\])dddd+/g, "$1" + dddd[0]);
	format = format.replace(/(^|[^\\])ddd/g, "$1" + ddd[0]);
	format = format.replace(/(^|[^\\])dd/g, "$1" + ii(d));
	format = format.replace(/(^|[^\\])d/g, "$1" + d);

	var H = utc ? date.getUTCHours() : date.getHours();
	format = format.replace(/(^|[^\\])HH+/g, "$1" + ii(H));
	format = format.replace(/(^|[^\\])H/g, "$1" + H);

	var h = H > 12 ? H - 12 : H == 0 ? 12 : H;
	format = format.replace(/(^|[^\\])hh+/g, "$1" + ii(h));
	format = format.replace(/(^|[^\\])h/g, "$1" + h);

	var m = utc ? date.getUTCMinutes() : date.getMinutes();
	format = format.replace(/(^|[^\\])mm+/g, "$1" + ii(m));
	format = format.replace(/(^|[^\\])m/g, "$1" + m);

	var s = utc ? date.getUTCSeconds() : date.getSeconds();
	format = format.replace(/(^|[^\\])ss+/g, "$1" + ii(s));
	format = format.replace(/(^|[^\\])s/g, "$1" + s);

	var f = utc ? date.getUTCMilliseconds() : date.getMilliseconds();
	format = format.replace(/(^|[^\\])fff+/g, "$1" + ii(f, 3));
	f = Math.round(f / 10);
	format = format.replace(/(^|[^\\])ff/g, "$1" + ii(f));
	f = Math.round(f / 10);
	format = format.replace(/(^|[^\\])f/g, "$1" + f);

	var T = H < 12 ? "AM" : "PM";
	format = format.replace(/(^|[^\\])TT+/g, "$1" + T);
	format = format.replace(/(^|[^\\])T/g, "$1" + T.charAt(0));

	var t = T.toLowerCase();
	format = format.replace(/(^|[^\\])tt+/g, "$1" + t);
	format = format.replace(/(^|[^\\])t/g, "$1" + t.charAt(0));

	var tz = -date.getTimezoneOffset();
	var K = utc || !tz ? "Z" : tz > 0 ? "+" : "-";
	if (!utc) {
		tz = Math.abs(tz);
		var tzHrs = Math.floor(tz / 60);
		var tzMin = tz % 60;
		K += ii(tzHrs) + ":" + ii(tzMin);
	}
	format = format.replace(/(^|[^\\])K/g, "$1" + K);

	var day = (utc ? date.getUTCDay() : date.getDay()) + 1;
	format = format.replace(new RegExp(dddd[0], "g"), dddd[day]);
	format = format.replace(new RegExp(ddd[0], "g"), ddd[day]);

	format = format.replace(new RegExp(MMMM[0], "g"), MMMM[M]);
	format = format.replace(new RegExp(MMM[0], "g"), MMM[M]);

	format = format.replace(/\\(.)/g, "$1");

	return format;
};

const timeElements = document.getElementsByTagName('time');
const epoch = new Date(0);

function patchDate(date, s) {
	let iso = date.toISOString();
	return new Date(iso.substr(0, 19-s.length) + s);
}

function updateTimers() {
	const now = new Date();
	for (let i=timeElements.length-1; i >= 0; i--) {
		const element = timeElements[i];
		const format = element.getAttribute('format');
		if (!format) continue;
		let since = element.getAttribute('since');
		let until = element.getAttribute('until');
		if (until) {
			if (until.startsWith('now+')) {
				until = new Date(now - epoch + +patchDate(epoch, until.slice(4))).toISOString().slice(0, 19);
				element.setAttribute('until', until)
			}
			datetime = new Date(patchDate(epoch, until) - epoch - now);
		} else if (since) {
			if (since == 'now') {
				since = now.toISOString().slice(0, 19);
				element.setAttribute('since', since);
			}
			datetime = new Date(now - epoch - patchDate(epoch, since));
		}
		else datetime = now;
		element.textContent = formatDate(datetime, format);
	}
}

/* Text editor */
function formatText(tag) {
	const selection = window.getSelection();
	if (!selection.rangeCount) return;

	const range = selection.getRangeAt(0);
	const parentElement = range.commonAncestorContainer.parentElement;

	if (parentElement.tagName === tag) {
		// If already wrapped, unwrap by replacing the tag's content with its children
		const unwrapped = document.createDocumentFragment();
		while (parentElement.firstChild) {
			unwrapped.appendChild(parentElement.firstChild);
		}
		parentElement.replaceWith(unwrapped);
	} else {
		// Otherwise, apply the formatting by wrapping the selection
		const wrapper = document.createElement(tag);
		wrapper.appendChild(range.extractContents());
		range.insertNode(wrapper);

		// Reselect the formatted text
		selection.removeAllRanges();
		const newRange = document.createRange();
		newRange.selectNodeContents(wrapper);
		selection.addRange(newRange);
	}
}