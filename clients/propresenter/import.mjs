import fetch from 'node-fetch';
import fs from 'fs';

// Base URL of the ProPresenter API
const BASE_URL = 'http://127.0.0.1:8084';

function parseProJson(data) {
	const verses = [];
	for (let group of data.presentation.groups) {
		for (let slide of group.slides) {
			if (slide.enabled === false) continue;
			const fields = slide.text.split('\r');
			let verse = slide.label ? `<h1>${slide.label}</h1>\n` : "";
			if (slide.notes) verse += `<blockquote>${slide.notes}</blockquote>\n`
			if (group.name) verse += `<h2>${group.name}</h2>\n`
			for (let i = 1; i <= fields.length; i++) {
				verse += `<p>${fields[i - 1].trim()}</p>\n`
			}
			verses.push(verse);
		}
	}
	return verses;
}


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
		// fs.writeFileSync(filename+'.json', JSON.stringify(presentation, '\t', 2));
		fs.writeFileSync(filename+'.txt', parseProJson(presentation).join('\n'));
	}
}