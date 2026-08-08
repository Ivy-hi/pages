import assert from "node:assert/strict";
import test from "node:test";

import {
	formatPlogDate,
	getPlogCopy,
} from "../src/lib/plog-language.mjs";

test("Plog language helpers localize dates and navigation copy", () => {
	const date = new Date(2026, 7, 8);

	assert.equal(formatPlogDate(date, "en"), "August 8, 2026");
	assert.equal(formatPlogDate(date, "zh-CN"), "2026年8月8日");
	assert.equal(getPlogCopy("en").back, "All entries");
	assert.equal(getPlogCopy("zh-CN").back, "全部文章");
	assert.equal(getPlogCopy("zh-CN").readAria("雨夜"), "阅读《雨夜》");
});
