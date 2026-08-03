const instructionChoiceHotspots = (leftLabel, rightLabel) => [
	{
		choice: 1,
		label: leftLabel,
		shape: "rect",
		x: 0.233,
		y: 0.469,
		width: 0.171,
		height: 0.063,
	},
	{
		choice: 2,
		label: rightLabel,
		shape: "rect",
		x: 0.627,
		y: 0.469,
		width: 0.171,
		height: 0.063,
	},
];

const formalChoiceHotspots = [
	{
		choice: 1,
		label: "Choose Option 1",
		shape: "circle",
		x: 0.0055,
		y: 0.1654,
		width: 0.408,
		height: 0.8235,
	},
	{
		choice: 1,
		label: "Choose Option 1 from its title",
		shape: "rect",
		x: 0.172,
		y: 0,
		width: 0.073,
		height: 0.042,
		pointerOnly: true,
	},
	{
		choice: 2,
		label: "Choose Option 2",
		shape: "circle",
		x: 0.5865,
		y: 0.1654,
		width: 0.408,
		height: 0.8235,
	},
	{
		choice: 2,
		label: "Choose Option 2 from its title",
		shape: "rect",
		x: 0.753,
		y: 0,
		width: 0.075,
		height: 0.042,
		pointerOnly: true,
	},
];

const steps = {};

function addAdvance(id, assetKey, next, delayMs = 0) {
	steps[id] = {
		id,
		kind: "advance",
		assetKey,
		delayMs,
		next,
	};
}

function addChoice(id, assetKey, options, hotspots, recordQuestion) {
	steps[id] = {
		id,
		kind: "choice",
		assetKey,
		delayMs: 0,
		options,
		hotspots,
		...(recordQuestion ? { recordQuestion } : {}),
	};
}

const delayedInstructionSlides = [1, 2, 5, 9, 10, 11, 12, 13, 14, 15, 16, 18];
const instructionSequence = [...delayedInstructionSlides, 19];

for (let index = 0; index < delayedInstructionSlides.length; index += 1) {
	const slide = delayedInstructionSlides[index];
	const next = instructionSequence[index + 1];
	addAdvance(
		`slide-${String(slide).padStart(2, "0")}`,
		`instruction-${slide}`,
		`slide-${String(next).padStart(2, "0")}`,
		500,
	);
}

addChoice(
	"slide-19",
	"instruction-19",
	{ 1: "slide-21", 2: "slide-20" },
	instructionChoiceHotspots("Choose Yes", "Choose No"),
);
addAdvance("slide-20", "instruction-20", "slide-22");
addAdvance("slide-21", "instruction-21", "slide-22");

addChoice(
	"slide-22",
	"instruction-22",
	{ 1: "slide-24", 2: "slide-23" },
	instructionChoiceHotspots("Choose 30", "Choose 50"),
);
addAdvance("slide-23", "instruction-23", "slide-25");
addAdvance("slide-24", "instruction-24", "slide-25");

addChoice(
	"slide-25",
	"instruction-25",
	{ 1: "slide-27", 2: "slide-26" },
	instructionChoiceHotspots("Choose Option 1", "Choose Option 2"),
);
addAdvance("slide-26", "instruction-26", "slide-28");
addAdvance("slide-27", "instruction-27", "slide-28");
addAdvance("slide-28", "instruction-28", "slide-29");
addAdvance("slide-29", "instruction-29", "question-01");

for (let question = 1; question <= 15; question += 1) {
	const id = `question-${String(question).padStart(2, "0")}`;
	const next = question === 15
		? "slide-30"
		: `question-${String(question + 1).padStart(2, "0")}`;
	addChoice(
		id,
		`question-${String(question).padStart(2, "0")}`,
		{ 1: next, 2: next },
		formalChoiceHotspots,
		question,
	);
}

addAdvance("slide-30", "instruction-30", "slide-31");
addAdvance("slide-31", "instruction-31", "results");
steps.results = { id: "results", kind: "result", delayMs: 0 };

export const EXPERIMENT_DEFINITION = {
	start: "slide-01",
	questionCount: 15,
	steps,
};

export const REQUIRED_DELAYED_SLIDES = delayedInstructionSlides.map(
	(slide) => `slide-${String(slide).padStart(2, "0")}`,
);
