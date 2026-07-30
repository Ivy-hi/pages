import { readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(currentDirectory, "..", "dist");
const imagePattern = /\.(jpe?g|png|webp|avif|gif|tiff?)$/i;
const textPattern = /\.(html|css|js|mjs|json|xml|txt|map)$/i;

async function walk(directory) {
	const files = [];

	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const fullPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walk(fullPath)));
		} else {
			files.push(fullPath);
		}
	}

	return files;
}

const files = await walk(outputDirectory);
let references = "";

for (const file of files.filter((candidate) => textPattern.test(candidate))) {
	references += await readFile(file, "utf8");
}

let removedFiles = 0;
let removedBytes = 0;

for (const image of files.filter((candidate) => imagePattern.test(candidate))) {
	if (references.includes(basename(image))) continue;

	removedBytes += (await stat(image)).size;
	await rm(image);
	removedFiles += 1;
}

console.log(
	`strip-unreferenced-assets: removed ${removedFiles} orphaned image file(s) (${(
		removedBytes /
		1024 /
		1024
	).toFixed(1)} MB).`,
);
