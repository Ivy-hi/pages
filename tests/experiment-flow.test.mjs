import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
	for (let question = 1; question <= 15; question += 1) {
		const id = `question-${String(question).padStart(2, "0")}`;
		const step = definition.steps[id];
		assert.equal(step.recordQuestion, question);
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

test("all selected preview assets exist and are explicitly imported", () => {
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

	for (let question = 1; question <= 15; question += 1) {
		const paddedQuestion = String(question).padStart(4, "0");
		const paddedIndex = String(question).padStart(3, "0");
		const filename = `Q${paddedQuestion}_IdxQ405${paddedIndex}_flower_round.png`;
		assert.ok(
			existsSync(new URL(`../exp/flower_round/${filename}`, import.meta.url)),
			`missing ${filename}`,
		);
		assert.match(runnerSource, new RegExp(`${filename.replace(".", "\\.")}\\?url`));
	}
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
	assert.doesNotMatch(source, /localStorage|sessionStorage|document\.cookie/i);
	assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|\/api\//i);
});
