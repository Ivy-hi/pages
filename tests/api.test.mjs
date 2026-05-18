import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { handleApiRequest } from "../functions/api/v1/[[path]].js";

test("admin auth, agent proposals, idempotency, approval, and logout", async () => {
	const env = createTestEnv();

	let response = await call(env, "GET", "/api/v1/admin/dashboard");
	assert.equal(response.status, 401);

	response = await call(env, "POST", "/api/v1/admin/login", {
		body: { password: "correct-password" },
	});
	assert.equal(response.status, 200);
	const cookie = response.headers.get("set-cookie").split(";")[0];

	response = await call(env, "POST", "/api/v1/admin/agents", {
		cookie,
		body: { name: "Planner Agent" },
	});
	assert.equal(response.status, 201);
	const agentPayload = await response.json();
	assert.match(agentPayload.api_key, /^ag_/);

	response = await call(env, "GET", "/api/v1/agent/snapshot");
	assert.equal(response.status, 401);

	response = await call(env, "GET", "/api/v1/agent/snapshot", {
		agentKey: "bad-key",
	});
	assert.equal(response.status, 401);

	response = await call(env, "GET", "/api/v1/agent/snapshot", {
		agentKey: agentPayload.api_key,
	});
	assert.equal(response.status, 200);
	assert.deepEqual((await response.json()).projects, []);

	const proposalBody = {
		type: "task",
		payload: {
			title: "Draft weekly plan",
			description: "Collect open work and prepare priorities.",
			priority: "P1",
			estimate_minutes: 45,
		},
	};
	response = await call(env, "POST", "/api/v1/agent/proposals", {
		agentKey: agentPayload.api_key,
		idempotencyKey: "agent-1-weekly-plan",
		body: proposalBody,
	});
	assert.equal(response.status, 201);
	const firstProposal = (await response.json()).proposal;
	assert.equal(firstProposal.status, "pending");

	response = await call(env, "POST", "/api/v1/agent/proposals", {
		agentKey: agentPayload.api_key,
		idempotencyKey: "agent-1-weekly-plan",
		body: proposalBody,
	});
	assert.equal(response.status, 200);
	const duplicatePayload = await response.json();
	assert.equal(duplicatePayload.deduplicated, true);
	assert.equal(duplicatePayload.proposal.id, firstProposal.id);

	response = await call(env, "GET", "/api/v1/admin/dashboard", { cookie });
	assert.equal(response.status, 200);
	let dashboard = await response.json();
	assert.equal(dashboard.proposals.filter((proposal) => proposal.status === "pending").length, 1);

	response = await call(env, "POST", `/api/v1/admin/proposals/${firstProposal.id}/approve`, {
		cookie,
		body: {
			create_task: true,
			create_schedule_block: false,
			update_project: false,
			payload: firstProposal.payload,
		},
	});
	assert.equal(response.status, 200);
	const approval = await response.json();
	assert.ok(approval.targets.taskId);

	response = await call(env, "GET", "/api/v1/admin/dashboard", { cookie });
	dashboard = await response.json();
	assert.equal(dashboard.tasks.length, 1);
	assert.equal(dashboard.tasks[0].title, "Draft weekly plan");
	assert.equal(dashboard.proposals[0].status, "approved");
	assert.ok(dashboard.audit_logs.some((log) => log.action === "approve"));

	response = await call(env, "POST", "/api/v1/admin/tasks", {
		agentKey: agentPayload.api_key,
		body: { title: "Should not work" },
	});
	assert.equal(response.status, 401);

	response = await call(env, "POST", "/api/v1/admin/logout", { cookie, body: {} });
	assert.equal(response.status, 200);

	response = await call(env, "GET", "/api/v1/admin/dashboard", { cookie });
	assert.equal(response.status, 401);
});

function createTestEnv() {
	const sqlite = new DatabaseSync(":memory:");
	sqlite.exec(readFileSync(new URL("../migrations/0001_agent_scheduler.sql", import.meta.url), "utf8"));
	return {
		DB: new SqliteD1(sqlite),
		ADMIN_PASSWORD: "correct-password",
		SESSION_SECRET: "test-session-secret-with-enough-length",
		APP_TIMEZONE: "Asia/Shanghai",
	};
}

async function call(env, method, path, options = {}) {
	const headers = new Headers();
	if (options.body) headers.set("Content-Type", "application/json");
	if (options.cookie) headers.set("Cookie", options.cookie);
	if (options.agentKey) headers.set("Authorization", `Bearer ${options.agentKey}`);
	if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);
	return handleApiRequest(new Request(`https://scheduler.test${path}`, {
		method,
		headers,
		body: options.body ? JSON.stringify(options.body) : undefined,
	}), env);
}

class SqliteD1 {
	constructor(db) {
		this.db = db;
	}

	prepare(sql) {
		return new SqliteD1Statement(this.db, sql);
	}
}

class SqliteD1Statement {
	constructor(db, sql) {
		this.db = db;
		this.sql = sql;
		this.bindings = [];
	}

	bind(...bindings) {
		this.bindings = bindings;
		return this;
	}

	async first() {
		const row = this.db.prepare(this.sql).get(...this.bindings);
		return row || null;
	}

	async all() {
		return { results: this.db.prepare(this.sql).all(...this.bindings) };
	}

	async run() {
		this.db.prepare(this.sql).run(...this.bindings);
		return { success: true };
	}
}
