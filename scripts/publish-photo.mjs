import { spawn } from "node:child_process";
import {
	access,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import {
	basename,
	dirname,
	extname,
	join,
	relative,
	resolve,
} from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = resolve(dirname(scriptPath), "..");
const manifestPath = join(repositoryRoot, "src", "data", "photos.json");
const photographyDirectory = join(
	repositoryRoot,
	"src",
	"assets",
	"photography",
);
const liveSite = "https://www.hanyi.life";
const supportedExtensions = new Set([
	".avif",
	".heic",
	".jpeg",
	".jpg",
	".png",
	".tif",
	".tiff",
	".webp",
]);

class CancelledError extends Error {}

function run(command, arguments_, options = {}) {
	const {
		capture = false,
		cwd = repositoryRoot,
		env = {},
	} = options;

	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(command, arguments_, {
			cwd,
			env: { ...process.env, ...env },
			stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
		});
		let stdout = "";
		let stderr = "";

		if (capture) {
			child.stdout.on("data", (chunk) => {
				stdout += chunk;
			});
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
		}

		child.on("error", rejectPromise);
		child.on("close", (code) => {
			if (code === 0) {
				resolvePromise({ stdout: stdout.trim(), stderr: stderr.trim() });
				return;
			}

			const detail = capture && stderr.trim() ? `\n${stderr.trim()}` : "";
			const error = new Error(
				`${command} ${arguments_.join(" ")} failed with exit code ${code}.${detail}`,
			);
			error.exitCode = code;
			error.stdout = stdout;
			error.stderr = stderr;
			rejectPromise(error);
		});
	});
}

export function parseArguments(arguments_) {
	const options = {
		alt: "",
		caption: "",
		filename: "",
		help: false,
		prepareOnly: false,
		releaseOnly: false,
		source: "",
		yes: false,
	};
	const positional = [];

	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index];
		const [flag, inlineValue] = argument.split(/=(.*)/s, 2);

		if (!argument.startsWith("--")) {
			positional.push(argument);
			continue;
		}

		if (flag === "--help") {
			options.help = true;
			continue;
		}
		if (flag === "--prepare-only" || flag === "--no-publish") {
			options.prepareOnly = true;
			continue;
		}
		if (flag === "--release-only") {
			options.releaseOnly = true;
			continue;
		}
		if (flag === "--yes") {
			options.yes = true;
			continue;
		}

		if (!["--alt", "--caption", "--filename"].includes(flag)) {
			throw new Error(`Unknown option: ${flag}`);
		}

		const value =
			inlineValue === undefined ? arguments_[index + 1] : inlineValue;
		if (!value || (inlineValue === undefined && value.startsWith("--"))) {
			throw new Error(`${flag} requires a value.`);
		}
		if (inlineValue === undefined) index += 1;

		if (flag === "--alt") options.alt = value;
		if (flag === "--caption") options.caption = value;
		if (flag === "--filename") options.filename = value;
	}

	if (positional.length > 1) {
		throw new Error("Provide only one source photo.");
	}
	options.source = positional[0] ?? "";

	if (options.releaseOnly && (options.source || options.prepareOnly)) {
		throw new Error(
			"--release-only cannot be combined with a photo or --prepare-only.",
		);
	}

	return options;
}

export function slugify(value) {
	return value
		.normalize("NFKD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-{2,}/g, "-");
}

function timestampName(date = new Date()) {
	const pad = (value) => String(value).padStart(2, "0");
	return [
		date.getFullYear(),
		pad(date.getMonth() + 1),
		pad(date.getDate()),
		"-",
		pad(date.getHours()),
		pad(date.getMinutes()),
		pad(date.getSeconds()),
	].join("");
}

export function buildFilename(caption, source, requested = "") {
	if (requested && basename(requested) !== requested) {
		throw new Error("--filename must be a filename, not a path.");
	}

	const requestedStem = requested
		? requested.slice(0, requested.length - extname(requested).length)
		: "";
	const sourceStem = basename(source, extname(source));
	const stem =
		slugify(requestedStem) ||
		slugify(caption) ||
		slugify(sourceStem) ||
		`photo-${timestampName()}`;

	return `${stem}.jpg`;
}

function printHelp() {
	console.log(`
Publish one photograph to the portfolio.

Double-click:
  publish-photo.command

Terminal:
  npm run photo:publish -- "/path/to/photo.jpg"

Non-interactive:
  npm run photo:publish -- "/path/to/photo.jpg" \\
    --caption "At the doorway" \\
    --alt "A weathered tiled doorway in an old neighborhood" \\
    --yes

Options:
  --caption TEXT   Caption shown below the photo
  --alt TEXT       Accessible visual description
  --filename NAME  Optional output filename; .jpg is always used
  --prepare-only   Optimize, test and commit locally without Git publish
  --release-only   Publish the current clean local branch after a failed release
  --yes            Skip the final confirmation
  --help            Show this help
`);
}

function normalizeText(value, label, maximumLength) {
	const normalized = value.trim().replace(/\s+/g, " ");
	if (!normalized) throw new Error(`${label} is required.`);
	if (normalized.length > maximumLength) {
		throw new Error(`${label} must be ${maximumLength} characters or fewer.`);
	}
	return normalized.replace(/[.。]+$/u, "");
}

function expandHome(value) {
	if (value === "~") return homedir();
	if (value.startsWith("~/")) return join(homedir(), value.slice(2));
	return value;
}

async function runAppleScript(lines, arguments_ = []) {
	const scriptArguments = lines.flatMap((line) => ["-e", line]);

	try {
		return (
			await run("osascript", [...scriptArguments, ...arguments_], {
				capture: true,
			})
		).stdout;
	} catch (error) {
		if (
			error.stderr?.includes("User canceled") ||
			error.stderr?.includes("-128")
		) {
			throw new CancelledError("Cancelled.");
		}
		throw error;
	}
}

async function choosePhotoWithDialog() {
	return runAppleScript(
		[
			"on run argv",
			'set chosenPhoto to choose file with prompt (item 1 of argv) of type {"public.image"}',
			"return POSIX path of chosenPhoto",
			"end run",
		],
		["选择要发布到主页的照片"],
	);
}

async function askWithDialog(prompt, defaultValue = "") {
	return runAppleScript(
		[
			"on run argv",
			'set answerDialog to display dialog (item 1 of argv) with title "照片发布器" default answer (item 2 of argv) buttons {"取消", "继续"} default button "继续"',
			"return text returned of answerDialog",
			"end run",
		],
		[prompt, defaultValue],
	);
}

async function confirmWithDialog(summary) {
	const answer = await runAppleScript(
		[
			"on run argv",
			'set answerDialog to display dialog (item 1 of argv) with title "照片发布器" buttons {"取消", "发布"} default button "发布"',
			"return button returned of answerDialog",
			"end run",
		],
		[summary],
	);
	return answer === "发布";
}

let terminalInterface;

async function askInTerminal(prompt) {
	if (!process.stdin.isTTY) {
		throw new Error(
			`${prompt} is missing. Pass it as an option in non-interactive mode.`,
		);
	}
	terminalInterface ??= createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	return terminalInterface.question(`${prompt}: `);
}

async function collectPhotoDetails(options) {
	const gui = process.env.PHOTO_PUBLISH_GUI === "1";
	let source = options.source;
	let caption = options.caption;
	let alt = options.alt;

	if (!source) {
		source = gui
			? await choosePhotoWithDialog()
			: await askInTerminal("Photo path");
	}
	if (!caption) {
		caption = gui
			? await askWithDialog("输入照片下方显示的短标题（建议英文）")
			: await askInTerminal("Caption");
	}
	if (!alt) {
		alt = gui
			? await askWithDialog(
					"用一句话描述照片中可见的内容（建议英文，用于无障碍访问）",
				)
			: await askInTerminal("Visual description");
	}

	source = resolve(expandHome(source.trim()));
	caption = normalizeText(caption, "Caption", 80);
	alt = normalizeText(alt, "Visual description", 240);
	const filename = buildFilename(caption, source, options.filename);

	if (!options.yes) {
		const summary = [
			`照片：${basename(source)}`,
			`标题：${caption}`,
			`描述：${alt}`,
			`网站文件：${filename}`,
			"",
			"确认后将自动压缩、测试并发布到主页。",
		].join("\n");
		const confirmed = gui
			? await confirmWithDialog(summary)
			: ["", "y", "yes"].includes(
					(await askInTerminal(`${summary}\nPublish? [Y/n]`))
						.trim()
						.toLowerCase(),
				);

		if (!confirmed) throw new CancelledError("Cancelled.");
	}

	return { alt, caption, filename, source };
}

async function assertCommandAvailable(command, versionArguments) {
	try {
		await run(command, versionArguments, { capture: true });
	} catch {
		throw new Error(
			`${command} is required but is not available on this computer.`,
		);
	}
}

async function assertCleanLocalBranch() {
	const branch = (
		await run("git", ["branch", "--show-current"], { capture: true })
	).stdout;
	if (branch !== "local") {
		throw new Error(
			`Run this publisher from the local branch. Current branch: ${branch || "(detached)"}.`,
		);
	}

	const trackedChanges = (
		await run(
			"git",
			["status", "--porcelain", "--untracked-files=no"],
			{ capture: true },
		)
	).stdout;
	if (trackedChanges) {
		throw new Error(
			`Tracked files already have changes. Commit or restore them first:\n${trackedChanges}`,
		);
	}
}

async function validateSourcePhoto(source) {
	const extension = extname(source).toLowerCase();
	if (!supportedExtensions.has(extension)) {
		throw new Error(
			`Unsupported photo type: ${extension || "(no extension)"}.`,
		);
	}

	try {
		await access(source);
		const sourceStat = await stat(source);
		if (!sourceStat.isFile()) throw new Error("Not a file.");
	} catch {
		throw new Error(`Photo not found or unreadable: ${source}`);
	}
}

async function inspectDimensions(source) {
	const output = (
		await run(
			"sips",
			["-g", "pixelWidth", "-g", "pixelHeight", source],
			{ capture: true },
		)
	).stdout;
	const width = Number(output.match(/pixelWidth:\s*(\d+)/)?.[1]);
	const height = Number(output.match(/pixelHeight:\s*(\d+)/)?.[1]);

	if (!width || !height) {
		throw new Error(`Could not read photo dimensions: ${source}`);
	}
	return { height, width };
}

async function optimizePhoto(source, destination) {
	const dimensions = await inspectDimensions(source);
	const resizeArguments =
		Math.max(dimensions.width, dimensions.height) > 3200
			? ["-Z", "3200"]
			: [];

	await run(
		"sips",
		[
			...resizeArguments,
			"-s",
			"format",
			"jpeg",
			"-s",
			"formatOptions",
			"82",
			source,
			"--out",
			destination,
		],
		{ capture: true },
	);

	return inspectDimensions(destination);
}

function validateManifest(value) {
	if (!Array.isArray(value)) {
		throw new Error("src/data/photos.json must contain an array.");
	}

	const seen = new Set();
	for (const [index, photo] of value.entries()) {
		if (
			!photo ||
			typeof photo.file !== "string" ||
			typeof photo.alt !== "string" ||
			typeof photo.caption !== "string"
		) {
			throw new Error(`Invalid photo entry at index ${index}.`);
		}
		if (seen.has(photo.file)) {
			throw new Error(`Duplicate photo filename in manifest: ${photo.file}`);
		}
		seen.add(photo.file);
	}

	return value;
}

async function pathExists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function formatMegabytes(bytes) {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function buildAndTest() {
	console.log("\nChecking the production build...");
	await run("npm", ["run", "build"]);
	console.log("\nRunning tests...");
	await run("npm", ["test"]);
}

async function preparePhoto(details) {
	await validateSourcePhoto(details.source);

	const destination = join(photographyDirectory, details.filename);
	if (await pathExists(destination)) {
		throw new Error(
			`A website photo already uses ${details.filename}. Choose another caption or --filename.`,
		);
	}

	const originalManifest = await readFile(manifestPath, "utf8");
	const manifest = validateManifest(JSON.parse(originalManifest));
	if (manifest.some((photo) => photo.file === details.filename)) {
		throw new Error(`The photo list already contains ${details.filename}.`);
	}

	const sourceBytes = (await stat(details.source)).size;
	let prepared = false;

	try {
		console.log(`\nOptimizing ${basename(details.source)}...`);
		const dimensions = await optimizePhoto(details.source, destination);
		const destinationBytes = (await stat(destination)).size;
		const nextManifest = [
			...manifest,
			{
				file: details.filename,
				alt: details.alt,
				caption: details.caption,
			},
		];
		await writeFile(
			manifestPath,
			`${JSON.stringify(nextManifest, null, 2)}\n`,
			"utf8",
		);
		prepared = true;

		console.log(
			`Prepared ${dimensions.width}x${dimensions.height}: ${formatMegabytes(sourceBytes)} -> ${formatMegabytes(destinationBytes)}.`,
		);
		await buildAndTest();
	} catch (error) {
		if (prepared) await writeFile(manifestPath, originalManifest, "utf8");
		await rm(destination, { force: true });
		console.error("\nThe photo changes were rolled back.");
		throw error;
	}

	return {
		destination,
		manifestPath,
		marker: `/${basename(details.filename, extname(details.filename))}.`,
	};
}

async function commitPhoto(details, prepared) {
	const manifestRelative = relative(repositoryRoot, prepared.manifestPath);
	const photoRelative = relative(repositoryRoot, prepared.destination);

	await run("git", ["add", manifestRelative, photoRelative]);
	const staged = (
		await run("git", ["diff", "--cached", "--name-only"], {
			capture: true,
		})
	).stdout
		.split("\n")
		.filter(Boolean)
		.sort();
	const expected = [manifestRelative, photoRelative].sort();

	if (JSON.stringify(staged) !== JSON.stringify(expected)) {
		throw new Error(
			`Unexpected staged files. Expected ${expected.join(", ")}, found ${staged.join(", ")}.`,
		);
	}

	const shortCaption =
		details.caption.length > 48
			? `${details.caption.slice(0, 47)}...`
			: details.caption;
	await run("git", [
		"commit",
		"-m",
		`Add ${shortCaption} photograph`,
	]);
}

async function verifyDeployment(marker, revision) {
	if (!marker) return false;
	if (process.env.PHOTO_PUBLISH_SKIP_LIVE_CHECK === "1") {
		console.log("\nLive deployment check skipped.");
		return false;
	}

	console.log("\nWaiting for Cloudflare Pages...");
	for (let attempt = 1; attempt <= 36; attempt += 1) {
		try {
			const response = await fetch(
				`${liveSite}/?v=${encodeURIComponent(revision)}-${Date.now()}`,
				{ headers: { "cache-control": "no-cache" } },
			);
			if (response.ok && (await response.text()).includes(marker)) {
				console.log(`Live: ${liveSite}`);
				return true;
			}
		} catch {
			// A temporary network failure should not undo a successful Git push.
		}

		process.stdout.write(".");
		await new Promise((resolvePromise) => setTimeout(resolvePromise, 5000));
	}

	console.warn(
		`\nGitHub was updated, but the live page was not confirmed within 3 minutes. Check ${liveSite} shortly.`,
	);
	return false;
}

async function releaseLocalBranch(subject, marker = "") {
	await assertCleanLocalBranch();
	console.log("\nPushing the local branch...");
	await run("git", ["push", "origin", "local"]);
	await run("git", ["fetch", "origin"]);

	const temporaryRoot = await mkdtemp(join(tmpdir(), "photo-publish-"));
	const worktree = join(temporaryRoot, "main");
	let worktreeAdded = false;
	let worktreeRemoved = false;
	let revision = "";

	try {
		await run("git", [
			"worktree",
			"add",
			"--detach",
			worktree,
			"origin/main",
		]);
		worktreeAdded = true;
		await run(
			"git",
			[
				"merge",
				"--no-ff",
				"local",
				"-m",
				`Merge ${subject} into main`,
			],
			{ cwd: worktree },
		);
		revision = (
			await run("git", ["rev-parse", "--short", "HEAD"], {
				capture: true,
				cwd: worktree,
			})
		).stdout;
		await run("git", ["push", "origin", "HEAD:main"], { cwd: worktree });
	} finally {
		if (worktreeAdded) {
			try {
				await run("git", ["merge", "--abort"], {
					capture: true,
					cwd: worktree,
				});
			} catch {
				// There is no merge to abort after a clean merge or push failure.
			}
			try {
				await run("git", ["worktree", "remove", worktree], {
					capture: true,
				});
				worktreeRemoved = true;
			} catch (error) {
				console.warn(
					`Could not remove temporary worktree at ${worktree}: ${error.message}`,
				);
			}
		}
		if (!worktreeAdded || worktreeRemoved) {
			await rm(temporaryRoot, { force: true, recursive: true });
		}
	}

	await verifyDeployment(marker, revision);
	return revision;
}

async function main() {
	const options = parseArguments(process.argv.slice(2));
	if (options.help) {
		printHelp();
		return;
	}

	await assertCommandAvailable("git", ["--version"]);
	await assertCommandAvailable("npm", ["--version"]);

	if (options.releaseOnly) {
		await assertCleanLocalBranch();
		await buildAndTest();
		const manifest = validateManifest(
			JSON.parse(await readFile(manifestPath, "utf8")),
		);
		const latestPhoto = manifest.at(-1);
		const marker = latestPhoto
			? `/${basename(latestPhoto.file, extname(latestPhoto.file))}.`
			: "";
		const subject = latestPhoto
			? `${latestPhoto.caption} photograph`
			: "photo updates";
		const revision = await releaseLocalBranch(subject, marker);
		console.log(`\nPublished main revision ${revision}.`);
		return;
	}

	await assertCommandAvailable("sips", ["--version"]);
	await assertCleanLocalBranch();
	const details = await collectPhotoDetails(options);
	const prepared = await preparePhoto(details);

	if (options.prepareOnly) {
		await commitPhoto(details, prepared);
		console.log(
			`\nPrepared and committed locally. Review the homepage, then run npm run photo:release when ready.`,
		);
		return;
	}

	await commitPhoto(details, prepared);
	const revision = await releaseLocalBranch(
		`${details.caption} photograph`,
		prepared.marker,
	);
	console.log(`\nPublished "${details.caption}" at ${liveSite} (${revision}).`);
}

if (resolve(process.argv[1] ?? "") === scriptPath) {
	main()
		.catch((error) => {
			if (error instanceof CancelledError) {
				console.log("\nCancelled.");
				process.exitCode = 130;
				return;
			}
			console.error(`\nPhoto publish failed: ${error.message}`);
			process.exitCode = 1;
		})
		.finally(() => {
			terminalInterface?.close();
		});
}
