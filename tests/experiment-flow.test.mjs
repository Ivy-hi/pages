import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
	EXPERIMENT_DEFINITION,
	REQUIRED_DELAYED_SLIDES,
} from "../src/data/experiment-flow.js";
import {
	createInitialState,
	getCurrentStep,
	transition,
	validateDefinition,
} from "../src/lib/experiment-machine.js";
import {
	buildQuestionCatalog,
	parseQuestionNumber,
	resolveStepAsset,
} from "../src/lib/experiment-assets.js";

const definition = EXPERIMENT_DEFINITION;

function stateAt(stepId, { unlocked = true, revision = 0, answers } = {}) {
	return {
		stepId,
		revision,
		unlocked,
		answers: answers || Array(definition.questionCount).fill(null),
	};
}

function unlock(state) {
	return transition(definition, state, {
		type: "UNLOCK",
		revision: state.revision,
	});
}

function advance(state) {
	return transition(definition, unlock(state), { type: "ADVANCE" });
}

test("experiment definition is complete and internally valid", () => {
	assert.deepEqual(validateDefinition(definition), []);
	assert.equal(definition.start, "slide-01");
	assert.equal(definition.questionCount, 15);
	assert.equal(definition.steps.results.kind, "result");
});

test("intro sequence skips missing slide 17 and waits only on specified slides", () => {
	const expected = [
		"slide-01",
		"slide-02",
		"slide-05",
		"slide-09",
		"slide-10",
		"slide-11",
		"slide-12",
		"slide-13",
		"slide-14",
		"slide-15",
		"slide-16",
		"slide-18",
		"slide-19",
	];

	let state = createInitialState(definition);
	assert.equal(state.stepId, expected[0]);
	for (const expectedNext of expected.slice(1)) {
		state = advance(state);
		assert.equal(state.stepId, expectedNext);
	}

	assert.deepEqual(REQUIRED_DELAYED_SLIDES, expected.slice(0, -1));
	for (const [id, step] of Object.entries(definition.steps)) {
		assert.equal(
			step.delayMs,
			REQUIRED_DELAYED_SLIDES.includes(id) ? 500 : 0,
			`unexpected delay on ${id}`,
		);
	}
	assert.equal(definition.steps["slide-17"], undefined);
});

test("the three instruction choices follow their left and right branches", () => {
	assert.equal(
		transition(definition, stateAt("slide-19"), { type: "CHOOSE", value: 1 }).stepId,
		"slide-21",
	);
	assert.equal(
		transition(definition, stateAt("slide-19"), { type: "CHOOSE", value: 2 }).stepId,
		"slide-20",
	);
	assert.equal(
		transition(definition, stateAt("slide-22"), { type: "CHOOSE", value: 1 }).stepId,
		"slide-24",
	);
	assert.equal(
		transition(definition, stateAt("slide-22"), { type: "CHOOSE", value: 2 }).stepId,
		"slide-23",
	);
	assert.equal(
		transition(definition, stateAt("slide-25"), { type: "CHOOSE", value: 1 }).stepId,
		"slide-27",
	);
	assert.equal(
		transition(definition, stateAt("slide-25"), { type: "CHOOSE", value: 2 }).stepId,
		"slide-26",
	);

	for (const stepId of ["slide-19", "slide-22", "slide-25"]) {
		const hotspots = definition.steps[stepId].hotspots;
		assert.deepEqual(hotspots.map((hotspot) => hotspot.choice), [1, 2]);
		assert.ok(hotspots[0].x + hotspots[0].width < hotspots[1].x);
	}
});

test("formal choices accept only the two plot/title regions", () => {
	const sharedHotspots = definition.steps["question-01"].hotspots;
	for (let question = 1; question <= 15; question += 1) {
		const id = `question-${String(question).padStart(2, "0")}`;
		const step = definition.steps[id];
		assert.equal(step.recordQuestion, question);
		assert.equal(step.hotspots, sharedHotspots);
		assert.equal(Object.hasOwn(step, "hotspotsByStyle"), false);
		assert.deepEqual(
			step.hotspots.map(({ choice, shape, pointerOnly = false }) => ({
				choice,
				shape,
				pointerOnly,
			})),
			[
				{ choice: 1, shape: "circle", pointerOnly: false },
				{ choice: 1, shape: "rect", pointerOnly: true },
				{ choice: 2, shape: "circle", pointerOnly: false },
				{ choice: 2, shape: "rect", pointerOnly: true },
			],
		);
		const leftCircle = step.hotspots[0];
		const rightCircle = step.hotspots[2];
		assert.ok(leftCircle.x + leftCircle.width < rightCircle.x);
		assert.ok(rightCircle.x + rightCircle.width <= 1);
	}
});

test("15 formal answers are recorded in order before slides 30, 31, and results", () => {
	let state = advance(stateAt("slide-29", { unlocked: false }));
	assert.equal(state.stepId, "question-01");

	const expectedAnswers = [];
	for (let question = 1; question <= 15; question += 1) {
		const choice = question % 2 === 0 ? 2 : 1;
		expectedAnswers.push(choice);
		state = transition(definition, unlock(state), { type: "CHOOSE", value: choice });
		assert.equal(state.answers[question - 1], choice);
	}

	assert.equal(state.stepId, "slide-30");
	assert.deepEqual(state.answers, expectedAnswers);
	state = advance(state);
	assert.equal(state.stepId, "slide-31");
	state = advance(state);
	assert.equal(state.stepId, "results");
	assert.equal(state.answers.filter((answer) => answer === 1).length, 8);
	assert.equal(state.answers.filter((answer) => answer === 2).length, 7);
});

test("locks reject early clicks, stale timers, invalid choices, and double clicks", () => {
	const initial = createInitialState(definition);
	assert.equal(
		transition(definition, initial, { type: "ADVANCE" }),
		initial,
		"click before unlock must be ignored",
	);
	assert.equal(
		transition(definition, initial, { type: "UNLOCK", revision: 9 }),
		initial,
		"stale unlock must be ignored",
	);

	const question = stateAt("question-01");
	assert.equal(
		transition(definition, question, { type: "CHOOSE", value: 3 }),
		question,
	);

	const afterFirstClick = transition(definition, question, { type: "CHOOSE", value: 1 });
	assert.equal(afterFirstClick.stepId, "question-02");
	assert.equal(afterFirstClick.unlocked, false);
	const afterDoubleClick = transition(definition, afterFirstClick, {
		type: "CHOOSE",
		value: 1,
	});
	assert.equal(afterDoubleClick, afterFirstClick);
	assert.deepEqual(afterDoubleClick.answers.slice(0, 2), [1, null]);
});

test("reset clears all in-memory answers and returns to slide 1", () => {
	const answered = transition(definition, stateAt("question-01"), {
		type: "CHOOSE",
		value: 2,
	});
	const reset = transition(definition, answered, { type: "RESET" });
	assert.deepEqual(reset, createInitialState(definition));
});

function readPngDimensions(path) {
	const header = readFileSync(path).subarray(0, 24);
	assert.equal(header.toString("ascii", 1, 4), "PNG", `${path} is not a PNG`);
	return {
		width: header.readUInt32BE(16),
		height: header.readUInt32BE(20),
	};
}

function realImageModuleMap(directory) {
	const directoryUrl = new URL(`../exp/${directory}/`, import.meta.url);
	return Object.fromEntries(
		readdirSync(directoryUrl)
			.filter((filename) => filename.endsWith(".png"))
			.map((filename) => {
				const imageUrl = new URL(filename, directoryUrl);
				const dimensions = readPngDimensions(imageUrl);
				return [
					imageUrl.pathname,
					{
						default: {
							src: `/test-assets/${directory}/${filename}`,
							...dimensions,
						},
					},
				];
			}),
	);
}

test("instruction assets required by the preview still exist", () => {
	const runnerPath = new URL("../src/components/ExperimentRunner.astro", import.meta.url);
	const runnerSource = readFileSync(runnerPath, "utf8");
	const instructionNumbers = [
		1, 2, 5, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
		28, 29, 30, 31,
	];

	for (const slide of instructionNumbers) {
		const filename = `幻灯片${slide}.jpeg`;
		assert.ok(
			existsSync(new URL(`../exp/Instruction/${filename}`, import.meta.url)),
			`missing ${filename}`,
		);
		assert.match(runnerSource, new RegExp(`${filename.replace(".", "\\.")}\\?url`));
	}
	assert.equal(instructionNumbers.length, 25);
});

test("question filenames are identified only by their Q####_ prefix", () => {
	assert.equal(parseQuestionNumber("Q0007_any_middle_name_can_change.png"), 7);
	assert.equal(parseQuestionNumber("/nested/path/Q0015_completely-different.png"), 15);
	assert.equal(parseQuestionNumber("prefix_Q0001_not-at-start.png"), null);
	assert.equal(parseQuestionNumber("Q001_too-short.png"), null);
	assert.equal(parseQuestionNumber("Q0001missing-underscore.png"), null);
});

test("both real question styles pair Q1-Q15 with their actual dimensions", () => {
	const roundModules = realImageModuleMap("flower_round");
	const columnModules = realImageModuleMap("flower_round_column");
	const catalog = buildQuestionCatalog({
		round: roundModules,
		column: columnModules,
	});

	assert.deepEqual(Object.keys(catalog),
		Array.from({ length: 15 }, (_, index) =>
			`question-${String(index + 1).padStart(2, "0")}`,
		),
	);
	for (let question = 1; question <= 15; question += 1) {
		const key = `question-${String(question).padStart(2, "0")}`;
		assert.deepEqual(Object.keys(catalog[key]), ["round", "column"]);
		for (const style of ["round", "column"]) {
			assert.match(catalog[key][style].src, new RegExp(`/Q${String(question).padStart(4, "0")}_`));
			assert.ok(catalog[key][style].width > 0);
			assert.ok(catalog[key][style].height > 0);
		}
		assert.equal(catalog[key].round.width, 3270);
		assert.equal(catalog[key].round.height, 1620);
		assert.equal(catalog[key].column.height, 1612);
	}

	assert.equal(Object.hasOwn(catalog, "question-16"), false);
	assert.doesNotMatch(JSON.stringify(catalog), /Q00(?:1[6-9]|2\d|30)_/);
});

test("question catalog rejects malformed, duplicate, missing, and invalid metadata", () => {
	const metadata = (src = "/asset.png") => ({
		default: { src, width: 100, height: 50 },
	});
	const complete = (middle) => Object.fromEntries(
		Array.from({ length: 15 }, (_, index) => {
			const number = String(index + 1).padStart(4, "0");
			return [`/Q${number}_${middle}.png`, metadata(`/${middle}-${number}.png`)];
		}),
	);
	const round = complete("round-middle");
	const column = complete("column-middle");

	assert.doesNotThrow(() => buildQuestionCatalog({ round, column }));
	const boundedCatalog = buildQuestionCatalog({
		round: { ...round, "/Q0016_future-round.png": metadata("/future-round.png") },
		column: { ...column, "/Q0016_future-column.png": metadata("/future-column.png") },
	});
	assert.equal(Object.hasOwn(boundedCatalog, "question-16"), false);
	assert.deepEqual(
		Object.keys(buildQuestionCatalog({ round, column }, { min: 2, max: 3 })),
		["question-02", "question-03"],
	);
	assert.throws(
		() => buildQuestionCatalog({ round, column }, { min: 4, max: 3 }),
		/Question range.*min less than or equal to max/,
	);
	assert.throws(
		() => buildQuestionCatalog({
			round: { ...round, "/not-a-question.png": metadata() },
			column,
		}),
		/Invalid round question filename.*Q####_ prefix/,
	);
	assert.throws(
		() => buildQuestionCatalog({
			round: { ...round, "/Q0001_another-middle.png": metadata() },
			column,
		}),
		/Duplicate round question 1/,
	);
	const missingRound = { ...round };
	delete missingRound["/Q0015_round-middle.png"];
	assert.throws(
		() => buildQuestionCatalog({ round: missingRound, column }),
		/Missing round question assets: Q0015/,
	);
	assert.throws(
		() => buildQuestionCatalog({
			round: { ...round, "/Q0001_round-middle.png": { default: { src: "", width: 0, height: 50 } } },
			column,
		}),
		/Invalid round question asset.*positive width\/height/,
	);
});

test("step asset resolution switches formal images without changing instruction images", () => {
	const payload = {
		instructions: {
			"instruction-1": { src: "/instruction.jpeg", width: 2880, height: 2160 },
		},
		questions: {
			"question-01": {
				round: { src: "/round.png", width: 3270, height: 1620 },
				column: { src: "/column.png", width: 3000, height: 1612 },
			},
		},
	};

	assert.equal(
		resolveStepAsset(payload, definition.steps["slide-01"], "column").src,
		"/instruction.jpeg",
	);
	assert.equal(
		resolveStepAsset(payload, definition.steps["question-01"], "round").src,
		"/round.png",
	);
	assert.equal(
		resolveStepAsset(payload, definition.steps["question-01"], "column").src,
		"/column.png",
	);
	assert.equal(resolveStepAsset(payload, definition.steps.results, "round"), undefined);
	assert.throws(
		() => resolveStepAsset(payload, definition.steps["question-01"], "unknown"),
		/Unknown question style/,
	);
});

test("preview runner does not persist or transmit experiment answers", () => {
	const source = readFileSync(
		new URL("../src/components/ExperimentRunner.astro", import.meta.url),
		"utf8",
	);
	assert.match(
		source,
		/<style is:global>/,
		"runtime-created hotspots and result rows need unscoped component styles",
	);
	assert.doesNotMatch(source, /indexedDB|localStorage|sessionStorage|document\.cookie/i);
	assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|\/api\//i);
});
