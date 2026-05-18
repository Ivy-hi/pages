const SESSION_COOKIE = "scheduler_session";
const DEFAULT_AGENT_SCOPES = ["read:full", "proposal:create"];
const PRIORITIES = new Set(["P0", "P1", "P2", "P3"]);
const TASK_STATUSES = new Set(["inbox", "next", "scheduled", "waiting", "done", "canceled"]);
const PROJECT_STATUSES = new Set(["active", "waiting", "done", "archived"]);
const SCHEDULE_STATUSES = new Set(["planned", "focus", "meeting", "done", "canceled"]);
const PROPOSAL_TYPES = new Set(["task", "calendar_block", "project_update"]);
const ADMIN_SESSION_HOURS = 12;

class HttpError extends Error {
	constructor(status, code, message, details) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

export async function onRequest(context) {
	return handleApiRequest(context.request, context.env);
}

export async function handleApiRequest(request, env) {
	if (request.method === "OPTIONS") {
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
				"Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
				"Access-Control-Max-Age": "86400",
			},
		});
	}

	try {
		if (!env.DB) {
			throw new HttpError(500, "missing_db_binding", "D1 binding DB is not configured.");
		}

		const store = new D1Store(env.DB);
		const url = new URL(request.url);
		const parts = url.pathname.replace(/^\/api\/v1\/?/, "").split("/").filter(Boolean);

		if (parts.length === 0 || parts[0] === "health") {
			return json({ ok: true, timezone: env.APP_TIMEZONE || "Asia/Shanghai" });
		}

		if (parts[0] === "admin") {
			return await routeAdmin(request, env, store, parts.slice(1));
		}

		if (parts[0] === "agent") {
			return await routeAgent(request, store, parts.slice(1));
		}

		throw new HttpError(404, "not_found", "Unknown API route.");
	} catch (error) {
		if (error instanceof HttpError) {
			return json({ error: error.code, message: error.message, details: error.details }, error.status);
		}

		console.error(error);
		return json({ error: "internal_error", message: "Unexpected server error." }, 500);
	}
}

async function routeAdmin(request, env, store, parts) {
	const [resource, id, action] = parts;

	if (request.method === "POST" && resource === "login") {
		return loginAdmin(request, env, store);
	}

	if (request.method === "GET" && resource === "session") {
		const session = await getAdminSession(request, env, store);
		return json({ authenticated: Boolean(session) });
	}

	const admin = await requireAdmin(request, env, store);

	if (request.method === "POST" && resource === "logout") {
		await store.deleteAdminSession(admin.sid);
		return json(
			{ ok: true },
			200,
			{ "Set-Cookie": expiredSessionCookie(request) },
		);
	}

	if (request.method === "GET" && resource === "dashboard") {
		return json(await store.getDashboardState());
	}

	if (request.method === "POST" && resource === "agents") {
		const body = await readJson(request);
		const apiKey = await generateApiKey();
		const agent = await store.createAgent({
			name: requireText(body.name, "name"),
			keyHash: await sha256Hex(apiKey),
			scopes: normalizeScopes(body.scopes),
		});
		await store.createAudit({
			actorType: "admin",
			actorId: "admin",
			action: "create",
			entityType: "agent",
			entityId: agent.id,
			details: { name: agent.name },
		});
		return json({ agent, api_key: apiKey }, 201);
	}

	if (request.method === "PATCH" && resource === "agents" && id) {
		const agent = await store.updateAgent(id, await readJson(request));
		await store.createAudit({
			actorType: "admin",
			actorId: "admin",
			action: "update",
			entityType: "agent",
			entityId: id,
			details: { active: agent.active, scopes: agent.scopes },
		});
		return json({ agent });
	}

	if (request.method === "POST" && resource === "projects") {
		const project = await store.createProject(normalizeProjectInput(await readJson(request)));
		await auditAdminMutation(store, "create", "project", project.id, project);
		return json({ project }, 201);
	}

	if (request.method === "PATCH" && resource === "projects" && id) {
		const project = await store.updateProject(id, normalizeProjectPatch(await readJson(request)));
		await auditAdminMutation(store, "update", "project", id, project);
		return json({ project });
	}

	if (request.method === "POST" && resource === "tasks") {
		const task = await store.createTask(normalizeTaskInput(await readJson(request)));
		await auditAdminMutation(store, "create", "task", task.id, task);
		return json({ task }, 201);
	}

	if (request.method === "PATCH" && resource === "tasks" && id) {
		const task = await store.updateTask(id, normalizeTaskPatch(await readJson(request)));
		await auditAdminMutation(store, "update", "task", id, task);
		return json({ task });
	}

	if (request.method === "POST" && resource === "schedule-blocks") {
		const block = await store.createScheduleBlock(normalizeScheduleInput(await readJson(request)));
		await auditAdminMutation(store, "create", "schedule_block", block.id, block);
		return json({ schedule_block: block }, 201);
	}

	if (request.method === "PATCH" && resource === "schedule-blocks" && id) {
		const block = await store.updateScheduleBlock(id, normalizeSchedulePatch(await readJson(request)));
		await auditAdminMutation(store, "update", "schedule_block", id, block);
		return json({ schedule_block: block });
	}

	if (resource === "proposals" && id && action === "approve" && request.method === "POST") {
		return approveProposal(request, store, id);
	}

	if (resource === "proposals" && id && action === "reject" && request.method === "POST") {
		const body = await readJson(request);
		const proposal = await store.rejectProposal(id, cleanText(body.reviewer_note));
		await auditAdminMutation(store, "reject", "proposal", id, {
			type: proposal.type,
			reviewer_note: proposal.reviewer_note,
		});
		return json({ proposal });
	}

	throw new HttpError(404, "not_found", "Unknown admin route.");
}

async function routeAgent(request, store, parts) {
	const agent = await requireAgent(request, store);
	const [resource] = parts;

	if (request.method === "GET" && resource === "snapshot") {
		requireScope(agent, "read:full");
		return json(await store.getAgentSnapshot(agent.id));
	}

	if (request.method === "POST" && resource === "proposals") {
		requireScope(agent, "proposal:create");
		const idempotencyKey = cleanText(request.headers.get("Idempotency-Key"));
		if (idempotencyKey) {
			const existing = await store.findProposalByIdempotency(agent.id, idempotencyKey);
			if (existing) {
				return json({ proposal: existing, deduplicated: true });
			}
		}

		const body = await readJson(request);
		const proposalInput = normalizeProposalInput(body);
		const proposal = await store.createProposal({
			agentId: agent.id,
			agentName: agent.name,
			type: proposalInput.type,
			payload: proposalInput.payload,
			idempotencyKey,
		});
		await store.createAudit({
			actorType: "agent",
			actorId: agent.id,
			action: "create",
			entityType: "proposal",
			entityId: proposal.id,
			details: { type: proposal.type, idempotency_key: idempotencyKey || null },
		});
		return json({ proposal }, 201);
	}

	throw new HttpError(404, "not_found", "Unknown agent route.");
}

async function loginAdmin(request, env, store) {
	const sessionSecret = requireSecret(env.SESSION_SECRET, "SESSION_SECRET");
	const body = await readJson(request);
	const password = String(body.password || "");

	if (!(await verifyAdminPassword(env, password))) {
		throw new HttpError(401, "invalid_credentials", "Password is not valid.");
	}

	const now = new Date();
	const expiresAt = new Date(now.getTime() + ADMIN_SESSION_HOURS * 60 * 60 * 1000);
	const sid = crypto.randomUUID();
	await store.createAdminSession({
		id: sid,
		expiresAt: expiresAt.toISOString(),
		createdAt: now.toISOString(),
		lastSeenAt: now.toISOString(),
	});

	const payload = {
		sub: "admin",
		sid,
		iat: Math.floor(now.getTime() / 1000),
		exp: Math.floor(expiresAt.getTime() / 1000),
	};
	const token = await signSession(payload, sessionSecret);
	return json(
		{ authenticated: true, expires_at: expiresAt.toISOString() },
		200,
		{ "Set-Cookie": sessionCookie(request, token, expiresAt) },
	);
}

async function getAdminSession(request, env, store) {
	try {
		const sessionSecret = requireSecret(env.SESSION_SECRET, "SESSION_SECRET");
		const token = getCookie(request.headers.get("Cookie") || "", SESSION_COOKIE);
		if (!token) return null;
		const payload = await verifySession(token, sessionSecret);
		const session = await store.getAdminSession(payload.sid);
		if (!session || Date.parse(session.expires_at) <= Date.now()) {
			return null;
		}
		await store.touchAdminSession(payload.sid);
		return payload;
	} catch {
		return null;
	}
}

async function requireAdmin(request, env, store) {
	const session = await getAdminSession(request, env, store);
	if (!session) {
		throw new HttpError(401, "not_authenticated", "Admin session is required.");
	}
	return session;
}

async function requireAgent(request, store) {
	const authorization = request.headers.get("Authorization") || "";
	const match = authorization.match(/^Bearer\s+(.+)$/i);
	if (!match) {
		throw new HttpError(401, "missing_agent_key", "Bearer API key is required.");
	}

	const keyHash = await sha256Hex(match[1].trim());
	const agent = await store.findActiveAgentByKeyHash(keyHash);
	if (!agent) {
		throw new HttpError(401, "invalid_agent_key", "Agent API key is invalid or inactive.");
	}
	await store.touchAgent(agent.id);
	return agent;
}

function requireScope(agent, scope) {
	if (!agent.scopes.includes(scope)) {
		throw new HttpError(403, "scope_denied", `Agent is missing ${scope}.`);
	}
}

async function approveProposal(request, store, proposalId) {
	const body = await readJson(request);
	const proposal = await store.getProposal(proposalId);
	if (!proposal) {
		throw new HttpError(404, "not_found", "Proposal was not found.");
	}
	if (proposal.status !== "pending") {
		throw new HttpError(409, "proposal_not_pending", "Only pending proposals can be approved.");
	}

	const payload = normalizeProposalApprovalPayload(body.payload || proposal.payload);
	const actions = normalizeApprovalActions(body, proposal.type);
	const targets = {
		projectId: null,
		taskId: null,
		scheduleBlockId: null,
	};

	if (actions.updateProject) {
		targets.projectId = await upsertProjectFromProposal(store, payload);
	}

	if (actions.createTask) {
		const projectId = targets.projectId || (await resolveProjectId(store, payload));
		const task = await store.createTask(normalizeTaskInput({
			project_id: projectId,
			title: payload.title,
			description: payload.description,
			status: payload.status || "inbox",
			priority: payload.priority,
			estimate_minutes: payload.estimate_minutes,
			due_at: payload.due_at,
		}));
		targets.taskId = task.id;
	}

	if (actions.createScheduleBlock) {
		const projectId = targets.projectId || (await resolveProjectId(store, payload));
		const block = await store.createScheduleBlock(normalizeScheduleInput({
			project_id: projectId,
			task_id: targets.taskId || payload.task_id || null,
			title: payload.title,
			description: payload.description,
			start_at: payload.start_at,
			end_at: payload.end_at,
			status: payload.schedule_status || payload.status || "planned",
		}));
		targets.scheduleBlockId = block.id;
	}

	const updated = await store.approveProposal(proposalId, {
		payload,
		reviewerNote: cleanText(body.reviewer_note),
		targetProjectId: targets.projectId,
		targetTaskId: targets.taskId,
		targetScheduleBlockId: targets.scheduleBlockId,
	});

	await auditAdminMutation(store, "approve", "proposal", proposalId, {
		type: proposal.type,
		targets,
	});

	return json({ proposal: updated, targets });
}

async function upsertProjectFromProposal(store, payload) {
	const projectId = cleanText(payload.project_id);
	const projectName = cleanText(payload.project_name || payload.name || payload.title);
	const projectPatch = normalizeProjectPatch({
		name: projectName || undefined,
		description: payload.project_description || payload.description,
		status: payload.project_status || payload.status,
		priority: payload.priority,
		progress: payload.progress,
	});

	if (projectId) {
		const existing = await store.getProject(projectId);
		if (!existing) {
			throw new HttpError(404, "project_not_found", "Referenced project was not found.");
		}
		const updated = await store.updateProject(projectId, projectPatch);
		return updated.id;
	}

	const existingByName = projectName ? await store.findProjectByName(projectName) : null;
	if (existingByName) {
		const updated = await store.updateProject(existingByName.id, projectPatch);
		return updated.id;
	}

	if (!projectName) {
		throw new HttpError(400, "project_name_required", "Project update needs project_id or project_name.");
	}

	const project = await store.createProject(normalizeProjectInput({
		name: projectName,
		description: payload.project_description || payload.description,
		status: payload.project_status || payload.status || "active",
		priority: payload.priority,
		progress: payload.progress,
	}));
	return project.id;
}

async function resolveProjectId(store, payload) {
	const projectId = cleanText(payload.project_id);
	if (projectId) {
		const existing = await store.getProject(projectId);
		if (!existing) {
			throw new HttpError(404, "project_not_found", "Referenced project was not found.");
		}
		return projectId;
	}

	const projectName = cleanText(payload.project_name);
	if (!projectName) return null;
	const project = await store.findProjectByName(projectName);
	return project ? project.id : null;
}

function normalizeProposalInput(body) {
	const type = cleanText(body.type);
	if (!PROPOSAL_TYPES.has(type)) {
		throw new HttpError(400, "invalid_type", "Proposal type must be task, calendar_block, or project_update.");
	}

	const payload = normalizeProposalApprovalPayload(
		body.payload && typeof body.payload === "object" ? body.payload : omit(body, ["type"]),
	);
	validateProposalShape(type, payload);
	return { type, payload };
}

function validateProposalShape(type, payload) {
	if (type === "task") {
		requireText(payload.title, "payload.title");
	}
	if (type === "calendar_block") {
		requireText(payload.title, "payload.title");
		requireIsoDate(payload.start_at, "payload.start_at");
		requireIsoDate(payload.end_at, "payload.end_at");
		if (Date.parse(payload.end_at) <= Date.parse(payload.start_at)) {
			throw new HttpError(400, "invalid_time_range", "payload.end_at must be after payload.start_at.");
		}
	}
	if (type === "project_update") {
		if (!cleanText(payload.project_id) && !cleanText(payload.project_name || payload.name || payload.title)) {
			throw new HttpError(400, "project_reference_required", "Project update needs project_id or project_name.");
		}
	}
}

function normalizeProposalApprovalPayload(payload) {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		throw new HttpError(400, "invalid_payload", "Proposal payload must be an object.");
	}
	return {
		...payload,
		title: cleanText(payload.title),
		name: cleanText(payload.name),
		description: cleanText(payload.description),
		project_id: cleanText(payload.project_id),
		project_name: cleanText(payload.project_name),
		project_description: cleanText(payload.project_description),
		project_status: cleanText(payload.project_status),
		task_id: cleanText(payload.task_id),
		priority: payload.priority ? normalizePriority(payload.priority) : undefined,
		status: cleanText(payload.status),
		schedule_status: cleanText(payload.schedule_status),
		estimate_minutes: optionalInteger(payload.estimate_minutes, "estimate_minutes"),
		progress: payload.progress === undefined || payload.progress === null || payload.progress === ""
			? undefined
			: clampInteger(payload.progress, 0, 100, "progress"),
		due_at: optionalIsoDate(payload.due_at, "due_at"),
		start_at: optionalIsoDate(payload.start_at, "start_at"),
		end_at: optionalIsoDate(payload.end_at, "end_at"),
	};
}

function normalizeApprovalActions(body, proposalType) {
	const explicit = ["create_task", "create_schedule_block", "update_project"].some((key) => key in body);
	if (!explicit) {
		return {
			createTask: proposalType === "task",
			createScheduleBlock: proposalType === "calendar_block",
			updateProject: proposalType === "project_update",
		};
	}

	const actions = {
		createTask: Boolean(body.create_task),
		createScheduleBlock: Boolean(body.create_schedule_block),
		updateProject: Boolean(body.update_project),
	};

	if (!actions.createTask && !actions.createScheduleBlock && !actions.updateProject) {
		throw new HttpError(400, "approval_action_required", "Choose at least one approval action.");
	}
	return actions;
}

function normalizeProjectInput(body) {
	return {
		name: requireText(body.name, "name"),
		description: cleanText(body.description),
		status: normalizeEnum(body.status || "active", PROJECT_STATUSES, "status"),
		priority: normalizePriority(body.priority || "P2"),
		progress: clampInteger(body.progress ?? 0, 0, 100, "progress"),
	};
}

function normalizeProjectPatch(body) {
	const patch = {};
	if ("name" in body && cleanText(body.name)) patch.name = cleanText(body.name);
	if ("description" in body) patch.description = cleanText(body.description);
	if ("status" in body && cleanText(body.status)) patch.status = normalizeEnum(body.status, PROJECT_STATUSES, "status");
	if ("priority" in body && cleanText(body.priority)) patch.priority = normalizePriority(body.priority);
	if ("progress" in body && body.progress !== undefined && body.progress !== null && body.progress !== "") {
		patch.progress = clampInteger(body.progress, 0, 100, "progress");
	}
	return patch;
}

function normalizeTaskInput(body) {
	return {
		project_id: optionalText(body.project_id),
		title: requireText(body.title, "title"),
		description: cleanText(body.description),
		status: normalizeEnum(body.status || "inbox", TASK_STATUSES, "status"),
		priority: normalizePriority(body.priority || "P2"),
		estimate_minutes: optionalInteger(body.estimate_minutes, "estimate_minutes"),
		due_at: optionalIsoDate(body.due_at, "due_at"),
		completed_at: optionalIsoDate(body.completed_at, "completed_at"),
	};
}

function normalizeTaskPatch(body) {
	const patch = {};
	if ("project_id" in body) patch.project_id = optionalText(body.project_id);
	if ("title" in body && cleanText(body.title)) patch.title = cleanText(body.title);
	if ("description" in body) patch.description = cleanText(body.description);
	if ("status" in body && cleanText(body.status)) patch.status = normalizeEnum(body.status, TASK_STATUSES, "status");
	if ("priority" in body && cleanText(body.priority)) patch.priority = normalizePriority(body.priority);
	if ("estimate_minutes" in body) patch.estimate_minutes = optionalInteger(body.estimate_minutes, "estimate_minutes");
	if ("due_at" in body) patch.due_at = optionalIsoDate(body.due_at, "due_at");
	if ("completed_at" in body) patch.completed_at = optionalIsoDate(body.completed_at, "completed_at");
	return patch;
}

function normalizeScheduleInput(body) {
	const startAt = requireIsoDate(body.start_at, "start_at");
	const endAt = requireIsoDate(body.end_at, "end_at");
	if (Date.parse(endAt) <= Date.parse(startAt)) {
		throw new HttpError(400, "invalid_time_range", "end_at must be after start_at.");
	}
	return {
		project_id: optionalText(body.project_id),
		task_id: optionalText(body.task_id),
		title: requireText(body.title, "title"),
		description: cleanText(body.description),
		start_at: startAt,
		end_at: endAt,
		status: normalizeEnum(body.status || "planned", SCHEDULE_STATUSES, "status"),
	};
}

function normalizeSchedulePatch(body) {
	const patch = {};
	if ("project_id" in body) patch.project_id = optionalText(body.project_id);
	if ("task_id" in body) patch.task_id = optionalText(body.task_id);
	if ("title" in body && cleanText(body.title)) patch.title = cleanText(body.title);
	if ("description" in body) patch.description = cleanText(body.description);
	if ("start_at" in body) patch.start_at = requireIsoDate(body.start_at, "start_at");
	if ("end_at" in body) patch.end_at = requireIsoDate(body.end_at, "end_at");
	if ("status" in body && cleanText(body.status)) patch.status = normalizeEnum(body.status, SCHEDULE_STATUSES, "status");

	if (patch.start_at && patch.end_at && Date.parse(patch.end_at) <= Date.parse(patch.start_at)) {
		throw new HttpError(400, "invalid_time_range", "end_at must be after start_at.");
	}
	return patch;
}

function normalizeScopes(scopes) {
	if (!Array.isArray(scopes) || scopes.length === 0) return DEFAULT_AGENT_SCOPES;
	return [...new Set(scopes.map((scope) => cleanText(scope)).filter(Boolean))];
}

function normalizePriority(priority) {
	const value = cleanText(priority || "P2").toUpperCase();
	if (!PRIORITIES.has(value)) {
		throw new HttpError(400, "invalid_priority", "Priority must be P0, P1, P2, or P3.");
	}
	return value;
}

function normalizeEnum(value, allowed, field) {
	const normalized = cleanText(value);
	if (!allowed.has(normalized)) {
		throw new HttpError(400, `invalid_${field}`, `${field} is not valid.`);
	}
	return normalized;
}

function requireText(value, field) {
	const text = cleanText(value);
	if (!text) {
		throw new HttpError(400, "missing_field", `${field} is required.`);
	}
	return text;
}

function optionalText(value) {
	const text = cleanText(value);
	return text || null;
}

function cleanText(value) {
	return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function optionalInteger(value, field) {
	if (value === undefined || value === null || value === "") return null;
	return clampInteger(value, 0, 100000, field);
}

function clampInteger(value, min, max, field) {
	const number = Number(value);
	if (!Number.isInteger(number) || number < min || number > max) {
		throw new HttpError(400, `invalid_${field}`, `${field} must be an integer between ${min} and ${max}.`);
	}
	return number;
}

function optionalIsoDate(value, field) {
	if (!value) return null;
	return requireIsoDate(value, field);
}

function requireIsoDate(value, field) {
	const text = requireText(value, field);
	if (Number.isNaN(Date.parse(text))) {
		throw new HttpError(400, `invalid_${field}`, `${field} must be a valid ISO date.`);
	}
	return new Date(text).toISOString();
}

function omit(object, keys) {
	const copy = { ...object };
	for (const key of keys) delete copy[key];
	return copy;
}

async function readJson(request) {
	const contentType = request.headers.get("Content-Type") || "";
	if (!contentType.includes("application/json")) {
		throw new HttpError(415, "unsupported_media_type", "Use application/json.");
	}

	try {
		return await request.json();
	} catch {
		throw new HttpError(400, "invalid_json", "Request body is not valid JSON.");
	}
}

function json(data, status = 200, headers = {}) {
	return Response.json(data, {
		status,
		headers: {
			"Cache-Control": "no-store",
			...headers,
		},
	});
}

async function auditAdminMutation(store, action, entityType, entityId, details) {
	await store.createAudit({
		actorType: "admin",
		actorId: "admin",
		action,
		entityType,
		entityId,
		details,
	});
}

function requireSecret(value, name) {
	if (!value) {
		throw new HttpError(500, "missing_secret", `${name} is not configured.`);
	}
	return value;
}

async function verifyAdminPassword(env, password) {
	if (env.ADMIN_PASSWORD_HASH) {
		return constantTimeEqual(await sha256Hex(password), env.ADMIN_PASSWORD_HASH);
	}
	const configured = requireSecret(env.ADMIN_PASSWORD, "ADMIN_PASSWORD");
	return constantTimeEqual(password, configured);
}

function sessionCookie(request, token, expiresAt) {
	const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
	return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Expires=${expiresAt.toUTCString()}${secure}`;
}

function expiredSessionCookie(request) {
	const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
	return `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

async function signSession(payload, secret) {
	const body = base64UrlEncode(JSON.stringify(payload));
	const signature = await hmacSha256(secret, body);
	return `${body}.${signature}`;
}

async function verifySession(token, secret) {
	const [body, signature] = token.split(".");
	if (!body || !signature) {
		throw new Error("Invalid session token.");
	}
	const expected = await hmacSha256(secret, body);
	if (!constantTimeEqual(signature, expected)) {
		throw new Error("Invalid signature.");
	}
	const payload = JSON.parse(base64UrlDecode(body));
	if (!payload.sid || payload.exp <= Math.floor(Date.now() / 1000)) {
		throw new Error("Expired session.");
	}
	return payload;
}

async function hmacSha256(secret, value) {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
	return base64UrlEncodeBytes(new Uint8Array(signature));
}

async function sha256Hex(value) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
	const a = String(left || "");
	const b = String(right || "");
	if (a.length !== b.length) return false;
	let result = 0;
	for (let index = 0; index < a.length; index += 1) {
		result |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}
	return result === 0;
}

async function generateApiKey() {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return `ag_${base64UrlEncodeBytes(bytes)}`;
}

function base64UrlEncode(value) {
	return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

function base64UrlEncodeBytes(bytes) {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value) {
	const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return new TextDecoder().decode(bytes);
}

function getCookie(header, name) {
	return header
		.split(";")
		.map((part) => part.trim())
		.find((part) => part.startsWith(`${name}=`))
		?.slice(name.length + 1) || "";
}

export class D1Store {
	constructor(db) {
		this.db = db;
	}

	async getAdminSession(id) {
		return first(this.db, "SELECT * FROM admin_sessions WHERE id = ?", [id]);
	}

	async createAdminSession(session) {
		await run(this.db, `
			INSERT INTO admin_sessions (id, expires_at, created_at, last_seen_at)
			VALUES (?, ?, ?, ?)
		`, [session.id, session.expiresAt, session.createdAt, session.lastSeenAt]);
	}

	async touchAdminSession(id) {
		await run(this.db, "UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?", [now(), id]);
	}

	async deleteAdminSession(id) {
		await run(this.db, "DELETE FROM admin_sessions WHERE id = ?", [id]);
	}

	async findActiveAgentByKeyHash(keyHash) {
		const row = await first(this.db, "SELECT * FROM agents WHERE key_hash = ? AND active = 1", [keyHash]);
		return row ? mapAgent(row) : null;
	}

	async touchAgent(id) {
		await run(this.db, "UPDATE agents SET last_seen_at = ? WHERE id = ?", [now(), id]);
	}

	async createAgent(input) {
		const id = crypto.randomUUID();
		const timestamp = now();
		await run(this.db, `
			INSERT INTO agents (id, name, key_hash, scopes, active, created_at, last_seen_at)
			VALUES (?, ?, ?, ?, 1, ?, NULL)
		`, [id, input.name, input.keyHash, JSON.stringify(input.scopes), timestamp]);
		return this.getAgent(id);
	}

	async getAgent(id) {
		const row = await first(this.db, "SELECT * FROM agents WHERE id = ?", [id]);
		return row ? mapAgent(row) : null;
	}

	async updateAgent(id, input) {
		const patch = {};
		if ("name" in input && cleanText(input.name)) patch.name = cleanText(input.name);
		if ("active" in input) patch.active = input.active ? 1 : 0;
		if ("scopes" in input) patch.scopes = JSON.stringify(normalizeScopes(input.scopes));
		await patchRow(this.db, "agents", id, patch);
		const agent = await this.getAgent(id);
		if (!agent) throw new HttpError(404, "not_found", "Agent was not found.");
		return agent;
	}

	async getDashboardState() {
		const [projects, tasks, scheduleBlocks, proposals, agents, auditLogs] = await Promise.all([
			this.listProjects(),
			this.listTasks(),
			this.listScheduleBlocks(),
			this.listProposals(),
			this.listAgents(),
			this.listAuditLogs(),
		]);

		return {
			projects,
			tasks,
			schedule_blocks: scheduleBlocks,
			proposals,
			agents,
			audit_logs: auditLogs,
		};
	}

	async getAgentSnapshot(agentId) {
		const [projects, tasks, scheduleBlocks, proposals] = await Promise.all([
			this.listProjects(),
			this.listTasks(),
			this.listScheduleBlocks(),
			all(this.db, `
				SELECT id, agent_id, agent_name, type, payload, status, target_project_id, target_task_id,
					target_schedule_block_id, reviewer_note, created_at, updated_at, decided_at
				FROM proposals
				ORDER BY created_at DESC
				LIMIT 100
			`).then((rows) => rows.map(mapProposal)),
		]);

		return {
			projects,
			tasks,
			schedule_blocks: scheduleBlocks,
			proposals,
			viewer: { agent_id: agentId },
		};
	}

	async listAgents() {
		const rows = await all(this.db, `
			SELECT id, name, scopes, active, created_at, last_seen_at
			FROM agents
			ORDER BY created_at DESC
		`);
		return rows.map(mapAgent);
	}

	async listProjects() {
		const rows = await all(this.db, "SELECT * FROM projects ORDER BY status, priority, updated_at DESC");
		return rows.map(mapProject);
	}

	async getProject(id) {
		const row = await first(this.db, "SELECT * FROM projects WHERE id = ?", [id]);
		return row ? mapProject(row) : null;
	}

	async findProjectByName(name) {
		const row = await first(this.db, "SELECT * FROM projects WHERE lower(name) = lower(?) LIMIT 1", [name]);
		return row ? mapProject(row) : null;
	}

	async createProject(input) {
		const id = crypto.randomUUID();
		const timestamp = now();
		const completedAt = input.status === "done" ? timestamp : null;
		await run(this.db, `
			INSERT INTO projects (id, name, description, status, priority, progress, created_at, updated_at, completed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, [id, input.name, input.description, input.status, input.priority, input.progress, timestamp, timestamp, completedAt]);
		return this.getProject(id);
	}

	async updateProject(id, patch) {
		if (Object.keys(patch).length === 0) {
			const project = await this.getProject(id);
			if (!project) throw new HttpError(404, "not_found", "Project was not found.");
			return project;
		}
		if (patch.status === "done" && !("completed_at" in patch)) patch.completed_at = now();
		if (patch.status && patch.status !== "done") patch.completed_at = null;
		await patchRow(this.db, "projects", id, patch, true);
		const project = await this.getProject(id);
		if (!project) throw new HttpError(404, "not_found", "Project was not found.");
		return project;
	}

	async listTasks() {
		const rows = await all(this.db, `
			SELECT tasks.*, projects.name AS project_name
			FROM tasks
			LEFT JOIN projects ON projects.id = tasks.project_id
			ORDER BY
				CASE tasks.status
					WHEN 'next' THEN 0
					WHEN 'scheduled' THEN 1
					WHEN 'inbox' THEN 2
					WHEN 'waiting' THEN 3
					WHEN 'done' THEN 4
					ELSE 5
				END,
				tasks.priority,
				COALESCE(tasks.due_at, tasks.created_at)
		`);
		return rows.map(mapTask);
	}

	async createTask(input) {
		const id = crypto.randomUUID();
		const timestamp = now();
		const completedAt = input.status === "done" ? input.completed_at || timestamp : input.completed_at || null;
		await run(this.db, `
			INSERT INTO tasks (id, project_id, title, description, status, priority, estimate_minutes, due_at, completed_at, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, [
			id,
			input.project_id,
			input.title,
			input.description,
			input.status,
			input.priority,
			input.estimate_minutes,
			input.due_at,
			completedAt,
			timestamp,
			timestamp,
		]);
		return this.getTask(id);
	}

	async getTask(id) {
		const row = await first(this.db, `
			SELECT tasks.*, projects.name AS project_name
			FROM tasks
			LEFT JOIN projects ON projects.id = tasks.project_id
			WHERE tasks.id = ?
		`, [id]);
		return row ? mapTask(row) : null;
	}

	async updateTask(id, patch) {
		if (patch.status === "done" && !patch.completed_at) patch.completed_at = now();
		if (patch.status && patch.status !== "done") patch.completed_at = null;
		await patchRow(this.db, "tasks", id, patch, true);
		const task = await this.getTask(id);
		if (!task) throw new HttpError(404, "not_found", "Task was not found.");
		return task;
	}

	async listScheduleBlocks() {
		const rows = await all(this.db, `
			SELECT schedule_blocks.*, projects.name AS project_name, tasks.title AS task_title
			FROM schedule_blocks
			LEFT JOIN projects ON projects.id = schedule_blocks.project_id
			LEFT JOIN tasks ON tasks.id = schedule_blocks.task_id
			ORDER BY start_at ASC
		`);
		return rows.map(mapScheduleBlock);
	}

	async createScheduleBlock(input) {
		const id = crypto.randomUUID();
		const timestamp = now();
		await run(this.db, `
			INSERT INTO schedule_blocks (id, project_id, task_id, title, description, start_at, end_at, status, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, [
			id,
			input.project_id,
			input.task_id,
			input.title,
			input.description,
			input.start_at,
			input.end_at,
			input.status,
			timestamp,
			timestamp,
		]);
		return this.getScheduleBlock(id);
	}

	async getScheduleBlock(id) {
		const row = await first(this.db, `
			SELECT schedule_blocks.*, projects.name AS project_name, tasks.title AS task_title
			FROM schedule_blocks
			LEFT JOIN projects ON projects.id = schedule_blocks.project_id
			LEFT JOIN tasks ON tasks.id = schedule_blocks.task_id
			WHERE schedule_blocks.id = ?
		`, [id]);
		return row ? mapScheduleBlock(row) : null;
	}

	async updateScheduleBlock(id, patch) {
		const existing = await this.getScheduleBlock(id);
		if (!existing) throw new HttpError(404, "not_found", "Schedule block was not found.");
		const nextStart = patch.start_at || existing.start_at;
		const nextEnd = patch.end_at || existing.end_at;
		if (Date.parse(nextEnd) <= Date.parse(nextStart)) {
			throw new HttpError(400, "invalid_time_range", "end_at must be after start_at.");
		}
		await patchRow(this.db, "schedule_blocks", id, patch, true);
		const block = await this.getScheduleBlock(id);
		return block;
	}

	async listProposals() {
		const rows = await all(this.db, "SELECT * FROM proposals ORDER BY created_at DESC LIMIT 200");
		return rows.map(mapProposal);
	}

	async getProposal(id) {
		const row = await first(this.db, "SELECT * FROM proposals WHERE id = ?", [id]);
		return row ? mapProposal(row) : null;
	}

	async findProposalByIdempotency(agentId, idempotencyKey) {
		const row = await first(this.db, `
			SELECT * FROM proposals
			WHERE agent_id = ? AND idempotency_key = ?
			LIMIT 1
		`, [agentId, idempotencyKey]);
		return row ? mapProposal(row) : null;
	}

	async createProposal(input) {
		const id = crypto.randomUUID();
		const timestamp = now();
		await run(this.db, `
			INSERT INTO proposals (id, agent_id, agent_name, type, payload, status, idempotency_key, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
		`, [
			id,
			input.agentId,
			input.agentName,
			input.type,
			JSON.stringify(input.payload),
			input.idempotencyKey || null,
			timestamp,
			timestamp,
		]);
		return this.getProposal(id);
	}

	async approveProposal(id, input) {
		const timestamp = now();
		await run(this.db, `
			UPDATE proposals
			SET status = 'approved',
				payload = ?,
				target_project_id = ?,
				target_task_id = ?,
				target_schedule_block_id = ?,
				reviewer_note = ?,
				updated_at = ?,
				decided_at = ?
			WHERE id = ?
		`, [
			JSON.stringify(input.payload),
			input.targetProjectId,
			input.targetTaskId,
			input.targetScheduleBlockId,
			input.reviewerNote || null,
			timestamp,
			timestamp,
			id,
		]);
		return this.getProposal(id);
	}

	async rejectProposal(id, reviewerNote) {
		const timestamp = now();
		await run(this.db, `
			UPDATE proposals
			SET status = 'rejected', reviewer_note = ?, updated_at = ?, decided_at = ?
			WHERE id = ? AND status = 'pending'
		`, [reviewerNote || null, timestamp, timestamp, id]);
		const proposal = await this.getProposal(id);
		if (!proposal) throw new HttpError(404, "not_found", "Proposal was not found.");
		if (proposal.status !== "rejected") {
			throw new HttpError(409, "proposal_not_pending", "Only pending proposals can be rejected.");
		}
		return proposal;
	}

	async createAudit(input) {
		await run(this.db, `
			INSERT INTO audit_logs (id, actor_type, actor_id, action, entity_type, entity_id, details, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, [
			crypto.randomUUID(),
			input.actorType,
			input.actorId || null,
			input.action,
			input.entityType,
			input.entityId,
			JSON.stringify(input.details || {}),
			now(),
		]);
	}

	async listAuditLogs() {
		const rows = await all(this.db, "SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100");
		return rows.map(mapAuditLog);
	}
}

async function first(db, sql, bindings = []) {
	return db.prepare(sql).bind(...bindings).first();
}

async function all(db, sql, bindings = []) {
	const result = await db.prepare(sql).bind(...bindings).all();
	return result.results || [];
}

async function run(db, sql, bindings = []) {
	return db.prepare(sql).bind(...bindings).run();
}

async function patchRow(db, table, id, patch, touchUpdatedAt = false) {
	const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
	if (entries.length === 0 && !touchUpdatedAt) return;
	const fields = entries.map(([key]) => `${key} = ?`);
	const bindings = entries.map(([, value]) => value);
	if (touchUpdatedAt) {
		fields.push("updated_at = ?");
		bindings.push(now());
	}
	bindings.push(id);
	await run(db, `UPDATE ${table} SET ${fields.join(", ")} WHERE id = ?`, bindings);
}

function mapAgent(row) {
	return {
		id: row.id,
		name: row.name,
		scopes: safeJson(row.scopes, DEFAULT_AGENT_SCOPES),
		active: Boolean(row.active),
		created_at: row.created_at,
		last_seen_at: row.last_seen_at,
	};
}

function mapProject(row) {
	return {
		id: row.id,
		name: row.name,
		description: row.description,
		status: row.status,
		priority: row.priority,
		progress: row.progress,
		created_at: row.created_at,
		updated_at: row.updated_at,
		completed_at: row.completed_at,
	};
}

function mapTask(row) {
	return {
		id: row.id,
		project_id: row.project_id,
		project_name: row.project_name || null,
		title: row.title,
		description: row.description,
		status: row.status,
		priority: row.priority,
		estimate_minutes: row.estimate_minutes,
		due_at: row.due_at,
		completed_at: row.completed_at,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

function mapScheduleBlock(row) {
	return {
		id: row.id,
		project_id: row.project_id,
		project_name: row.project_name || null,
		task_id: row.task_id,
		task_title: row.task_title || null,
		title: row.title,
		description: row.description,
		start_at: row.start_at,
		end_at: row.end_at,
		status: row.status,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

function mapProposal(row) {
	return {
		id: row.id,
		agent_id: row.agent_id,
		agent_name: row.agent_name,
		type: row.type,
		payload: safeJson(row.payload, {}),
		status: row.status,
		idempotency_key: row.idempotency_key || undefined,
		target_project_id: row.target_project_id,
		target_task_id: row.target_task_id,
		target_schedule_block_id: row.target_schedule_block_id,
		reviewer_note: row.reviewer_note,
		created_at: row.created_at,
		updated_at: row.updated_at,
		decided_at: row.decided_at,
	};
}

function mapAuditLog(row) {
	return {
		id: row.id,
		actor_type: row.actor_type,
		actor_id: row.actor_id,
		action: row.action,
		entity_type: row.entity_type,
		entity_id: row.entity_id,
		details: safeJson(row.details, {}),
		created_at: row.created_at,
	};
}

function safeJson(value, fallback) {
	try {
		return JSON.parse(value);
	} catch {
		return fallback;
	}
}

function now() {
	return new Date().toISOString();
}
