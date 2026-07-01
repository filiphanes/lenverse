#!/usr/bin/env node
// convert.mjs — convert OpenLyrics / OpenSong XML songs to lenverse plain text.
//
// The plain-text song format is one block per verse, blocks separated by a
// blank line, each block optionally starting with `[NAME]`:
//
//   [V1]
//   first line of the verse
//   second line
//
//   [C]
//   chorus line
//
// Usage:
//   node convert.mjs <song.xml>            # write song.txt next to it
//   node convert.mjs <folder>              # convert every .xml under it (recursive)
//   node convert.mjs <path> --overwrite    # overwrite existing .txt files
//
// The converters are EXPORTED (see bottom) so batch-convert.mjs can reuse them
// without duplicating logic. No dependencies — node:fs / node:path only.
// Works with `bun` too.

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";

// --- shared helpers --------------------------------------------------------

export function decodeEntities(s) {
	return s
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&"); // last, so we don't double-decode
}

// Normalize a verse body: trim each line, drop blank lines (a blank line
// inside a block would split it into two verses).
export function normalizeVerseBody(parts) {
	return parts
		.join("\n")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length)
		.join("\n");
}

export function buildOutput(ordered, verses) {
	return (
		ordered
			.filter((name) => verses[name])
			.map((name) => (name ? `[${name}]\n` : "") + verses[name])
			.join("\n\n") + "\n"
	);
}

// --- OpenLyrics (namespaced, <verse name="..."><lines>...) -----------------

export function openLyricsToText(raw) {
	const orderMatch = raw.match(/<verseOrder[^>]*>([\s\S]*?)<\/verseOrder>/);
	const order = orderMatch
		? orderMatch[1].trim().toUpperCase().split(/\s+/).filter(Boolean)
		: [];
	const verses = {};
	const seen = new Set();
	const ordered = [];
	const note = (n) => { if (n && !seen.has(n)) { seen.add(n); ordered.push(n); } };
	order.forEach(note);

	const verseRe = /<verse\b([^>]*)>([\s\S]*?)<\/verse>/g;
	let m;
	while ((m = verseRe.exec(raw))) {
		const nameMatch = m[1].match(/name\s*=\s*"([^"]*)"/i);
		const name = (nameMatch ? nameMatch[1] : "").toUpperCase();
		const parts = [];
		const linesRe = /<lines\b[^>]*>([\s\S]*?)<\/lines>/g;
		let lm;
		while ((lm = linesRe.exec(m[2]))) {
			parts.push(linesToText(lm[1]));
		}
		const body = normalizeVerseBody(parts);
		if (!body) continue;
		verses[name] = verses[name] ? verses[name] + "\n" + body : body;
		note(name);
	}
	return buildOutput(ordered, verses);
}

// Turn the inner content of a <lines> element into plain text.
export function linesToText(s) {
	const text = s
		.replace(/<br\s*\/?>(?:<\/br>)?/gi, "\n") // line breaks -> newline
		.replace(/<chord\b[^>]*\/?>/gi, "")        // drop chords
		.replace(/<comment\b[^>]*>[\s\S]*?<\/comment>/gi, "") // drop comments
		.replace(/<[^>]+>/g, "");                  // any remaining tags
	return decodeEntities(text);
}

// --- OpenSong (plain <song>, <lyrics>[v1]...</lyrics>) ---------------------

export function openSongToText(raw) {
	const presMatch = raw.match(/<presentation[^>]*>([\s\S]*?)<\/presentation>/i);
	const order = presMatch
		? presMatch[1].trim().toUpperCase().split(/\s+/).filter(Boolean)
		: [];
	const lyMatch = raw.match(/<lyrics[^>]*>([\s\S]*?)<\/lyrics>/i);
	const lyrics = lyMatch ? decodeEntities(lyMatch[1]) : "";

	const verses = {};
	const seen = new Set();
	const ordered = [];
	const note = (n) => { if (n && !seen.has(n)) { seen.add(n); ordered.push(n); } };
	order.forEach(note);

	let name = "";
	let lines = [];
	const flush = () => {
		const body = normalizeVerseBody(lines);
		if (body) verses[name] = verses[name] ? verses[name] + "\n" + body : body;
		lines = [];
	};
	for (const lineRaw of lyrics.split("\n")) {
		if (!lineRaw.trim()) continue;
		const c = lineRaw[0];
		if (c === "[") { flush(); name = lineRaw.replace(/[\[\]]/g, "").trim().toUpperCase(); note(name); }
		else if (c === "." || c === ";" || c === "|") continue; // chords / comments
		else lines.push(lineRaw);
	}
	flush();
	Object.keys(verses).forEach(note);
	return buildOutput(ordered, verses);
}

// Identify which dialect an XML string is in.
export function detectDialect(raw) {
	if (/openlyrics\.info\/namespace/.test(raw)) return "openlyrics";
	if (/<verse\s[^>]*\bname\s*=/.test(raw)) return "openlyrics";
	if (/<lyrics[^>]*>[\s\S]*?<\/lyrics>/i.test(raw)) return "opensong";
	return "unknown";
}

export function xmlToText(raw) {
	if (/openlyrics\.info\/namespace/.test(raw)) return openLyricsToText(raw);
	if (/<verse\s[^>]*\bname\s*=/.test(raw)) return openLyricsToText(raw);
	return openSongToText(raw);
}

// Convert one .xml file to a sibling .txt.
// Returns { file, out, status, dialect } or null if `file` is not .xml.
//   status: "wrote" | "skip"  (skip = .txt already exists and !overwrite)
export function convertFile(file, { overwrite = false } = {}) {
	if (extname(file).toLowerCase() !== ".xml") return null;
	const raw = readFileSync(file, "utf8");
	const dialect = detectDialect(raw);
	const text = xmlToText(raw);
	const out = file.replace(/\.[^.]+$/, ".txt");
	if (existsSync(out) && !overwrite) return { file, out, status: "skip", dialect };
	writeFileSync(out, text);
	return { file, out, status: "wrote", dialect };
}

// Recursively collect every file path under `dir`.
export function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		if (name.startsWith(".")) continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

// --- CLI driver (only when invoked directly, not when imported) ------------

function main() {
	const args = process.argv.slice(2);
	const flags = new Set(args.filter((a) => a.startsWith("--")));
	const targets = args.filter((a) => !a.startsWith("--"));
	const overwrite = flags.has("--overwrite");
	const target = targets[0];

	if (!target) {
		console.error("Usage: node convert.mjs <song.xml | folder> [--overwrite]");
		process.exit(1);
	}

	const st = statSync(target);
	const files = st.isDirectory() ? walk(resolve(target)) : [resolve(target)];

	let wrote = 0, skipped = 0;
	for (const f of files) {
		const r = convertFile(f, { overwrite });
		if (!r) continue;
		console.log(`${r.status === "wrote" ? "wrote" : "skip (exists)"}: ${r.out}`);
		if (r.status === "wrote") wrote++; else skipped++;
	}
	console.log(`done — ${wrote} wrote, ${skipped} skipped`);
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] || "").href;
if (invokedDirectly) main();
