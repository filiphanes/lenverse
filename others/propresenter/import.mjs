import fetch from 'node-fetch';
import fs from 'fs';
// Reuse the shared, isomorphic converters so this importer stays in sync with
// the rest of the app instead of keeping its own copy of the parser.
import { readProPresenter, writeText } from '../../modules/song/format.mjs';

// Base URL of the ProPresenter API
const BASE_URL = 'http://127.0.0.1:8084';

console.log('Fetching presentations...');
let url = `${BASE_URL}/v1/libraries`;
console.log(url);
let res = await fetch(url);
const libraries = await res.json()
for (let library of libraries) {
	url = `${BASE_URL}/v1/library/${library.uuid}`;
	console.log(url);
	res = await fetch(url);
	const songs = await res.json()
	try {
		fs.mkdirSync(`songs/${library.name}`);
	} catch (err) {
		console.log(err);
	}
	for (let song of songs.items) {
		url = `${BASE_URL}/v1/presentation/${song.uuid}`;
		console.log(url);
		res = await fetch(url);
		if (res.status != 200) {
			console.log(url, 'not found');
			continue;
		}
		const presentation = await res.json();
		// console.log('presentation', presentation);
		const filename = `songs/${library.name}/${song.name}`;
		// Convert the ProPresenter presentation to lenverse plain text via the
		// shared model (read → write), so format logic lives in one place.
		fs.writeFileSync(filename+'.txt', writeText(readProPresenter(presentation)));
	}
}