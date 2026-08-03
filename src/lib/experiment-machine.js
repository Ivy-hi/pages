/**
 * @typedef {{
 *   stepId: string,
 *   revision: number,
 *   unlocked: boolean,
 *   answers: Array<1 | 2 | null>
 * }} ExperimentState
 */

export function createInitialState(definition) {
	return {
		stepId: definition.start,
		revision: 0,
		unlocked: false,
		answers: Array(definition.questionCount).fill(null),
	};
}

export function getCurrentStep(definition, state) {
	return definition.steps[state.stepId];
}

export function getNextStepIds(step) {
	if (step.kind === "advance") return [step.next];
	if (step.kind === "choice") return [...new Set(Object.values(step.options))];
	return [];
}

export function transition(definition, state, event) {
	if (event?.type === "RESET") return createInitialState(definition);

	const step = getCurrentStep(definition, state);
	if (!step) return state;

	if (event?.type === "UNLOCK") {
		if (event.revision !== state.revision || state.unlocked || step.kind === "result") {
			return state;
		}
		return { ...state, unlocked: true };
	}

	if (!state.unlocked) return state;

	if (event?.type === "ADVANCE" && step.kind === "advance") {
		return moveTo(state, step.next);
	}

	if (event?.type === "CHOOSE" && step.kind === "choice") {
		const choice = Number(event.value);
		const next = step.options[choice];
		if ((choice !== 1 && choice !== 2) || !next) return state;

		let answers = state.answers;
		if (step.recordQuestion) {
			const answerIndex = step.recordQuestion - 1;
			if (answers[answerIndex] !== null) return state;
			answers = [...answers];
			answers[answerIndex] = choice;
		}

		return moveTo({ ...state, answers }, next);
	}

	return state;
}

function moveTo(state, stepId) {
	return {
		...state,
		stepId,
		revision: state.revision + 1,
		unlocked: false,
	};
}

export function validateDefinition(definition) {
	const errors = [];
	const steps = definition?.steps || {};

	if (!steps[definition?.start]) errors.push("The start step does not exist.");
	if (!Number.isInteger(definition?.questionCount) || definition.questionCount < 1) {
		errors.push("questionCount must be a positive integer.");
	}

	const recordedQuestions = [];
	for (const [id, step] of Object.entries(steps)) {
		if (step.id !== id) errors.push(`Step ${id} has a mismatched id.`);
		if (!Number.isFinite(step.delayMs) || step.delayMs < 0) {
			errors.push(`Step ${id} has an invalid delay.`);
		}

		if (step.kind === "advance") {
			if (!steps[step.next]) errors.push(`Step ${id} points to missing step ${step.next}.`);
		} else if (step.kind === "choice") {
			for (const value of [1, 2]) {
				if (!steps[step.options?.[value]]) {
					errors.push(`Step ${id} has a missing choice ${value} target.`);
				}
			}
			if (!Array.isArray(step.hotspots) || step.hotspots.length < 2) {
				errors.push(`Step ${id} must provide choice hotspots.`);
			}
			for (const hotspot of step.hotspots || []) {
				if (hotspot.choice !== 1 && hotspot.choice !== 2) {
					errors.push(`Step ${id} has an invalid hotspot choice.`);
				}
				for (const key of ["x", "y", "width", "height"]) {
					if (!Number.isFinite(hotspot[key]) || hotspot[key] < 0 || hotspot[key] > 1) {
						errors.push(`Step ${id} has an invalid hotspot ${key}.`);
					}
				}
				if (hotspot.x + hotspot.width > 1 || hotspot.y + hotspot.height > 1) {
					errors.push(`Step ${id} has a hotspot outside the image.`);
				}
			}
			if (step.recordQuestion) recordedQuestions.push(step.recordQuestion);
		} else if (step.kind !== "result") {
			errors.push(`Step ${id} has an unknown kind.`);
		}
	}

	const expectedQuestions = Array.from(
		{ length: definition.questionCount || 0 },
		(_, index) => index + 1,
	);
	if (recordedQuestions.join(",") !== expectedQuestions.join(",")) {
		errors.push("Recorded questions must be continuous and ordered.");
	}

	return errors;
}
