HOST = window.location.host;

function connectToFileWebSocket(path, onUpdateCallback) {
	let ws;
	let pending = null; // last value queued while CONNECTING

	function send(text) {
		if (!ws) return;
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(text);
		} else {
			// Still CONNECTING (or reconnecting): hold the latest value and
			// flush it once the handshake completes.
			pending = text;
		}
	}

	function reconnect() {
		const proto = location.protocol === "https:" ? "wss:" : "ws:";
		ws = new WebSocket(`${proto}//${HOST}${path}`);
		ws.onopen = () => {
			console.log("WebSocket connected to", path);
			document.body.classList.add("connected");
			if (pending !== null) {
				const text = pending;
				pending = null;
				ws.send(text);
			}
		};

		if (typeof onUpdateCallback === "function") {
			ws.onmessage = ({ data }) => {
				onUpdateCallback(data);
			}
		}

		ws.onclose = () => {
			console.log("WebSocket connection to ", path, "closed");
			setTimeout(reconnect, 1000);
			document.body.classList.remove("connected");
		};

		ws.onerror = (error) => {
			console.error(`WebSocket error on ${path}:`, error);
		};
	}
	reconnect();

	return function updateFileWS(text) {
		return send(text);
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

function appendButton(parent, content, onclick, className) {
	let button = document.createElement("button");
	button.innerHTML = content;
	button.onclick = onclick;
	if (className) button.className = className;
	parent.appendChild(button);
}

async function fetchDirRecursive(dir, prefix) {
    if (prefix === undefined) prefix = '';
    const data = await GET(dir+prefix);
    const names = data.trim().split("\n");
    for (let i=0; i<names.length; i++) {
        const name = names[i];
        if (name.endsWith('/')) {
            folders.push(name);
            const subnames = await fetchDirRecursive(dir, prefix+name);
            names.splice(i, 1, ...subnames);
            i += subnames.length - 1;
        } else {
            names[i] = prefix+name;
        }
    }
    return names;
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

// --- XML -> plain text -----------------------------------------------------
// The lenverse plain-text song format is one block per verse, blocks separated
// by a blank line, each block optionally starting with `[NAME]`:
//
//   [V1]
//   first line of the verse
//   second line
//
//   [C]
//   chorus line
//
// These converters turn OpenLyrics / OpenSong XML into that format so a song
// can be saved as a normal editable .txt (the inverse direction of the parse*
// functions above, which build HTML for display).

// Walk a DOM node, returning its text. `<br/>` becomes a newline; `<chord>` and
// `<comment>` are dropped so the output is clean lyrics.
function nodeToText(node) {
	let text = '';
	for (const child of node.childNodes) {
		if (child.nodeType === Node.TEXT_NODE) {
			text += child.textContent;
		} else if (child.nodeType === Node.ELEMENT_NODE) {
			const tag = child.localName || child.nodeName.toLowerCase();
			if (tag === 'br') text += '\n';
			else if (tag === 'chord' || tag === 'comment') continue;
			else text += nodeToText(child);
		}
	}
	return text;
}

// Normalize a verse body: trim each line, drop blanks (a blank line inside a
// block would otherwise split it into two verses).
function normalizeVerseBody(parts) {
	return parts
		.join('\n')
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length)
		.join('\n');
}

// Convert an OpenLyrics XML string (or parsed Document) to plain text.
// Verses are emitted once each, ordered by <verseOrder> first, then by document
// order for any verses not listed there.
function openLyricsToText(raw) {
	const xml = (typeof raw === 'string')
		? new DOMParser().parseFromString(raw, 'application/xml')
		: raw;
	const ns = 'http://openlyrics.info/namespace/2009/song';
	const orderEl = xml.getElementsByTagNameNS(ns, 'verseOrder')[0];
	const order = orderEl
		? orderEl.textContent.trim().toUpperCase().split(/\s+/).filter(Boolean)
		: [];
	const verses = {};       // NAME -> body text
	const seen = new Set();
	const ordered = [];
	const note = (name) => { if (name && !seen.has(name)) { seen.add(name); ordered.push(name); } };
	order.forEach(note);     // verseOrder sets the desired order
	for (const verse of xml.getElementsByTagNameNS(ns, 'verse')) {
		const name = (verse.getAttribute('name') || '').toUpperCase();
		const parts = [];
		for (const linesEl of verse.getElementsByTagNameNS(ns, 'lines')) {
			parts.push(nodeToText(linesEl));
		}
		const body = normalizeVerseBody(parts);
		if (!body) continue;
		verses[name] = verses[name] ? verses[name] + '\n' + body : body;
		note(name);           // append if it was missing from verseOrder
	}
	return ordered
		.filter(name => verses[name])
		.map(name => (name ? `[${name}]\n` : '') + verses[name])
		.join('\n\n') + '\n';
}

// Convert an OpenSong XML string (or parsed Document) to plain text.
// OpenSong stores lyrics as a text blob inside <lyrics> with `[label]` markers
// and line-type prefixes (`.` chords, `;`/`|` comments, leading space lyrics).
function openSongToText(raw) {
	const xml = (typeof raw === 'string')
		? new DOMParser().parseFromString(raw, 'application/xml')
		: raw;
	const presEl = xml.getElementsByTagName('presentation')[0];
	const order = presEl
		? presEl.textContent.trim().toUpperCase().split(/\s+/).filter(Boolean)
		: [];
	const lyricsEl = xml.getElementsByTagName('lyrics')[0];
	const verses = {};
	const seen = new Set();
	const ordered = [];
	const note = (name) => { if (name && !seen.has(name)) { seen.add(name); ordered.push(name); } };
	order.forEach(note);
	if (lyricsEl) {
		let name = '';
		let lines = [];
		const flush = () => {
			const body = normalizeVerseBody(lines);
			if (body) verses[name] = verses[name] ? verses[name] + '\n' + body : body;
			lines = [];
		};
		for (const lineRaw of lyricsEl.textContent.split('\n')) {
			if (!lineRaw.trim()) continue;
			const c = lineRaw[0];
			if (c === '[') { flush(); name = lineRaw.replace(/[\[\]]/g, '').trim().toUpperCase(); note(name); }
			else if (c === '.' || c === ';' || c === '|') continue; // chords / comments
			else lines.push(lineRaw);
		}
		flush();
	}
	Object.keys(verses).forEach(note);
	return ordered
		.filter(name => verses[name])
		.map(name => (name ? `[${name}]\n` : '') + verses[name])
		.join('\n\n') + '\n';
}

// Detect which XML dialect a song is in and convert it to plain text.
function songXmlToText(raw) {
	const xml = (typeof raw === 'string')
		? new DOMParser().parseFromString(raw, 'application/xml')
		: raw;
	const ns = 'http://openlyrics.info/namespace/2009/song';
	if (xml.getElementsByTagNameNS(ns, 'lyrics').length) return openLyricsToText(xml);
	return openSongToText(xml);
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
	if (!raw) raw = await GET(`/songs/${encodeURIComponent(filename)}`);
	if (!raw) return [];

	let verses;
	if (raw.startsWith("<?xml")) {
		const parser = new DOMParser();
		const xml = parser.parseFromString(raw, "application/xml");
		try {
			verses = parseOpenLyricsXml(xml);
			if (verses && verses.length) console.log('Parsed as OpenLyrics XML');
		} catch (error) { console.error(error); }
		if (!verses || !verses.length) {
			try {
				verses = parseOpenSongXml(xml);
				if (verses && verses.length) console.log('Parsed as OpenSong XML');
			} catch (error) { console.error(error); }
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
	return verses || [];
}

function normalizeText(text) {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "") // Remove diacritics
		.toLowerCase()
}

// Timers
function pad(num, len) {
	return String(num).padStart(len||2, "0");
}

let MMMM = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
let MMM = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
let dddd = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
let ddd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function K(date, utc) {
	if (utc) return "Z";
	const offset = -date.getTimezoneOffset();
	const sign = offset >= 0 ? "+" : "-";
	const absOffset = Math.abs(offset);
	return `${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`;
}

function formatDate(date, format, utc) {
	const get = (method) => utc ? date[`getUTC${method}`]() : date[`get${method}`]();
	const y = get("FullYear");
	const M = get("Month");
	const d = get("Date");
	const H = get("Hours");
	const m = get("Minutes");
	const s = get("Seconds");
	// const f = get("Milliseconds");
	const day = get("Day");

	const replacements = {
		yyyy: String(y),
		yy: String(y).slice(-2),
		M: M,
		MM: pad(M),
		MMM: MMM[M - 1],
		MMMM: MMMM[M - 1],
		d: d,
		dd: pad(d),
		ddd: ddd[day],
		dddd: dddd[day],
		H: String(H),
		HH: pad(H),
		h: String(H % 12 || 12),
		hh: pad(H % 12 || 12),
		m: String(m),
		mm: pad(m),
		s: String(s),
		ss: pad(s),
		// f: Math.floor(f / 100),
		// ff: pad(Math.floor(f / 10), 2),
		// fff: pad(f, 3),
		TT: H < 12 ? "AM" : "PM",
		tt: H < 12 ? "am" : "pm",
	};

	return format.replace(/(\\.)|([a-zA-Z])\2*/g, (match, escaped) => (escaped ? escaped.slice(1) : replacements[match] || (match == 'K' ? K(date, utc) : match)));
}

function addPeriodToDate(date, period) {
	// Parse ISO 8601 period syntax
	const match = period.match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+\.?\d*)S)?)?$/);
	if (!match) return date;
	const [, years, months, weeks, days, hours, minutes, seconds] = match;
	const target = new Date(date);
	if (years)   target.setFullYear(target.getFullYear() + parseInt(years, 0,10));
	if (months)  target.setMonth(target.getMonth() + parseInt(months, 0,10));
	if (weeks)   target.setDate(target.getDate() + parseInt(weeks, 0,10) * 7);
	if (days)    target.setDate(target.getDate() + parseInt(days, 0,10));
	if (hours)   target.setHours(target.getHours() + parseInt(hours, 0,10));
	if (minutes) target.setMinutes(target.getMinutes() + parseInt(minutes, 0,10));
	if (seconds) target.setSeconds(target.getSeconds() + parseFloat(seconds));
	return target;
}

const timeElements = document.getElementsByTagName('time');
const today = new Date();
today.setHours(0);
today.setMinutes(0);
today.setSeconds(0);

function patchDate(date, s) {
	const iso = date.toISOString();
	return new Date(iso.substr(0, 19-s.length) + s + iso.slice(19));
}

function doNothing() {}

async function updateTimers() {
	const now = new Date();
	for (let i=0; i < timeElements.length; i++) {
		const element = timeElements[i];
		if (!element.updateTextContent) {
			const format = element.textContent;
			if (!format) {
				element.updateTextContent = doNothing();
				continue;
			}
			const sinceSrc = element.getAttribute('since-src');
			const since = element.hasAttribute('since') || (sinceSrc && await GET(sinceSrc));
			const untilSrc = element.getAttribute('until-src');
			const until = element.hasAttribute('until') || (untilSrc && await GET(untilSrc));
			const datetime =  element.getAttribute('datetime');
			let target = now;
			if (!datetime) {
				target = now;
			} else if (datetime.startsWith('P')) {
				if (since) target = patchDate(today, since);
				// TODO: else if (until) target = patchDate(today, until);
				target = addPeriodToDate(target, datetime);
			} else {
				target = patchDate(today, datetime);
			}
			
			if (until) {
				element.updateTextContent = function (now) {
					const diff = target - now;
					this.textContent = formatDate(new Date(diff), format);
					if (diff >= 0) this.classList.add('finished');
				}
			} else if (since) {
				element.updateTextContent = function (now) {
					const diff = now - target;
					this.textContent = formatDate(new Date(diff), format);
					if (diff <= 0) this.classList.add('finished');
				}
			} else {
				element.updateTextContent = function(now) {
					this.textContent = formatDate(now, format);
				}
			}
		}
		element.updateTextContent(now);
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
