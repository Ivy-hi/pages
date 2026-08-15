export const QUESTION_STYLES = Object.freeze(["round", "column"]);
export const DEFAULT_QUESTION_STYLE = "round";

const QUESTION_FILENAME_PATTERN = /^Q(\d{4})_/;

function filenameFromPath(path) {
	return String(path).split(/[\\/]/).pop() || "";
}

/**
 * Read the formal-question number from the filename prefix only.
 * Everything after `Q####_` is deliberately treated as opaque.
 */
export function parseQuestionNumber(path) {
	const match = QUESTION_FILENAME_PATTERN.exec(filenameFromPath(path));
	return match ? Number.parseInt(match[1], 10) : null;
}

function normalizeImageModule(moduleEntry, style, path) {
	const metadata = moduleEntry?.default;
	if (!metadata || typeof metadata !== "object") {
		throw new Error(
			`Invalid ${style} question asset "${path}": expected an eager import with default ImageMetadata.`,
		);
	}

	const { src, width, height } = metadata;
	if (
		typeof src !== "string" ||
		src.length === 0 ||
		!Number.isFinite(width) ||
		width <= 0 ||
		!Number.isFinite(height) ||
		height <= 0
	) {
		throw new Error(
			`Invalid ${style} question asset "${path}": ImageMetadata must provide src and positive width/height.`,
		);
	}

	return { src, width, height };
}

function indexStyleModules(style, moduleMap, min, max) {
	if (!moduleMap || typeof moduleMap !== "object" || Array.isArray(moduleMap)) {
		throw new Error(`Invalid ${style} question asset map: expected an eager import module map.`);
	}

	const indexed = new Map();
	for (const [path, moduleEntry] of Object.entries(moduleMap)) {
		const questionNumber = parseQuestionNumber(path);
		if (questionNumber === null) {
			throw new Error(
				`Invalid ${style} question filename "${path}": expected a Q####_ prefix.`,
			);
		}

		// Later questions may coexist in the source folders, but the preview is
		// intentionally limited to the configured inclusive question range.
		if (questionNumber < min || questionNumber > max) continue;

		if (indexed.has(questionNumber)) {
			throw new Error(
				`Duplicate ${style} question ${questionNumber}: filenames must have unique Q####_ prefixes.`,
			);
		}

		indexed.set(
			questionNumber,
			normalizeImageModule(moduleEntry, style, path),
		);
	}

	const missing = [];
	for (let questionNumber = min; questionNumber <= max; questionNumber += 1) {
		if (!indexed.has(questionNumber)) missing.push(questionNumber);
	}
	if (missing.length > 0) {
		throw new Error(
			`Missing ${style} question assets: ${missing
				.map((number) => `Q${String(number).padStart(4, "0")}`)
				.join(", ")}.`,
		);
	}

	return indexed;
}

/**
 * Build the paired Q1-Q30 catalog from eager Astro image module maps.
 *
 * @param {{ round: Record<string, { default: object }>, column: Record<string, { default: object }> }} styleModules
 * @param {{ min?: number, max?: number }} options
 */
export function buildQuestionCatalog(styleModules, { min = 1, max = 30 } = {}) {
	if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
		throw new Error("Question range must use positive integers with min less than or equal to max.");
	}

	const indexedByStyle = Object.fromEntries(
		QUESTION_STYLES.map((style) => [
			style,
			indexStyleModules(style, styleModules?.[style], min, max),
		]),
	);

	const catalog = {};
	for (let questionNumber = min; questionNumber <= max; questionNumber += 1) {
		const assetKey = `question-${String(questionNumber).padStart(2, "0")}`;
		catalog[assetKey] = Object.fromEntries(
			QUESTION_STYLES.map((style) => [style, indexedByStyle[style].get(questionNumber)]),
		);
	}
	return catalog;
}

/** Resolve the current step's instruction or style-specific formal-question image. */
export function resolveStepAsset(assetPayload, step, activeStyle = DEFAULT_QUESTION_STYLE) {
	if (!step?.assetKey) return undefined;

	if (step.recordQuestion) {
		if (!QUESTION_STYLES.includes(activeStyle)) {
			throw new Error(`Unknown question style "${activeStyle}".`);
		}
		return assetPayload?.questions?.[step.assetKey]?.[activeStyle];
	}

	return assetPayload?.instructions?.[step.assetKey];
}
