import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import test from "node:test";

import {
	buildFilename,
	createTemporaryDirectory,
	parseArguments,
	slugify,
} from "../scripts/publish-photo.mjs";

test("slugify creates a stable website filename", () => {
	assert.equal(slugify("Café at the Doorway"), "cafe-at-the-doorway");
	assert.equal(slugify("  Across --- the plain  "), "across-the-plain");
});

test("buildFilename uses caption, source, and explicit names safely", () => {
	assert.equal(
		buildFilename("At the Doorway", "/tmp/IMG_1234.HEIC"),
		"at-the-doorway.jpg",
	);
	assert.equal(
		buildFilename("", "/tmp/IMG_1234.HEIC"),
		"img-1234.jpg",
	);
	assert.equal(
		buildFilename("Ignored", "/tmp/photo.jpg", "My Final.JPG"),
		"my-final.jpg",
	);
	assert.throws(
		() => buildFilename("Photo", "/tmp/photo.jpg", "../unsafe.jpg"),
		/filename, not a path/,
	);
});

test("parseArguments supports interactive and agent workflows", () => {
	assert.deepEqual(
		parseArguments([
			"/tmp/photo.jpg",
			"--caption",
			"At the doorway",
			"--alt=A tiled doorway",
			"--yes",
		]),
		{
			alt: "A tiled doorway",
			caption: "At the doorway",
			filename: "",
			help: false,
			prepareOnly: false,
			releaseOnly: false,
			source: "/tmp/photo.jpg",
			yes: true,
		},
	);
	assert.equal(parseArguments(["--no-publish"]).prepareOnly, true);
	assert.equal(parseArguments(["--release-only"]).releaseOnly, true);
	assert.throws(
		() => parseArguments(["one.jpg", "two.jpg"]),
		/only one source photo/,
	);
});

test(
	"temporary publishing directory falls back when the preferred path is unusable",
	async (context) => {
		const testRoot = await mkdtemp(join("/tmp", "photo-publisher-test-"));
		context.after(() => rm(testRoot, { force: true, recursive: true }));

		const unusablePath = join(testRoot, "not-a-directory");
		const fallbackDirectory = join(testRoot, "fallback");
		await writeFile(unusablePath, "occupied by a file", "utf8");

		const temporaryDirectory = await createTemporaryDirectory([
			unusablePath,
			fallbackDirectory,
		]);

		assert.equal(dirname(temporaryDirectory), fallbackDirectory);
		assert.match(basename(temporaryDirectory), /^photo-publish-/);
	},
);
