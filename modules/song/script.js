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

// --- song parsing / conversion (delegates to format.mjs) ------------------
// All format detection, parsing and writing lives in format.mjs so the SAME
// code runs in the browser, in Node and in Bun. A dynamic import keeps this
// classic script file dependency-free at parse time (and resolves relative to
// this script, i.e. modules/song/format.mjs).

let _formatModule;
function formatModule() {
	return (_formatModule ||= import('./format.mjs'));
}

// Load a song (any supported format) and return an array of HTML verse blocks
// (one per section) for display in the editor / verses panel.
async function parseSong(filename, raw) {
	if (!filename) return [];
	const f = await formatModule();
	if (!raw) raw = await GET(`/songs/${encodeURIComponent(filename)}`);
	if (!raw) return [];
	return f.modelToHtml(f.readSong(raw, { filename }));
}

// Convert one song format into another, returning the output string.
async function convertSong(raw, fromFormat, toFormat, filename) {
	const f = await formatModule();
	return f.convert(raw, fromFormat, toFormat, { filename });
}

// Detect a song's format from its raw bytes (+ optional filename hint).
async function detectSongFormat(filename, raw) {
	const f = await formatModule();
	return f.detectFormat(filename, raw);
}

// Legacy entry point for older editor flows: OpenLyrics/OpenSong XML → text.
async function songXmlToText(raw) {
	const f = await formatModule();
	return f.convert(raw, f.detectFormat('', raw), 'text');
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
