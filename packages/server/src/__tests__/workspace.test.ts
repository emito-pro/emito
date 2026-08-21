/**
 * Tests for 9 workspace-scoped endpoints (Task 2):
 *   - Preferences: GET /workspace/:wsId/preferences, PUT /workspace/:wsId/preferences
 *   - Defaults: GET /workspace/:wsId/defaults, PUT /workspace/:wsId/defaults
 *   - Integrations: GET, POST /workspace/:wsId/integrations, PUT /:id, POST /:id/deactivate
 *   - Members: GET /workspace/:wsId/members/preferences
 *
 * Auth rules (post B-005 fix):
 *   - Preferences endpoints: auth: "subscriber" + requireMembership — members can read/write own prefs, non-members 403
 *   - All other workspace routes: auth: "workspace" — enforceWorkspaceRole blocks writes for non-admin members
 *   - Non-member (null): always 403
 *
 * Agent rules applied: #1, #3, #4, #7, #12, #15, #26
 */

import { createHmac } from "node:crypto";
import {
	InMemoryConsentRepository,
	InMemoryDeadLetterRepository,
	InMemoryInboxRepository,
	InMemoryIntegrationRepository,
	InMemoryNotificationRepository,
	InMemoryPreferenceRepository,
	InMemorySubscriberRepository,
	InMemorySuppressionRepository,
	InMemoryWorkspaceDefaultRepository,
} from "@emito/core";
import type { IntegrationRecord } from "@emito/core";
import { EMITO_ERROR_CODE } from "@emito/types";
import type { PreferenceRecord, ResolveSubscriberId, WorkspaceDefault } from "@emito/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyHS256 } from "../auth/hs256.js";
import { createEmitoServer } from "../handler.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JWT_SECRET = "test-secret-key-at-least-32-chars-long";
const SUBSCRIBER_ID = "sub_1";
const WORKSPACE_ID = "ws_1";
const WORKSPACE_PATH = `/emito/v1/workspace/${WORKSPACE_ID}`;

type WorkspaceRole = "admin" | "member" | null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJwt(): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify({ subscriberId: SUBSCRIBER_ID })).toString("base64url");
	const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
	return `${header}.${body}.${sig}`;
}

function authHeader(): Record<string, string> {
	return { Authorization: `Bearer ${makeJwt()}` };
}

function createTestResolveSubscriberId(secret: string): ResolveSubscriberId {
	return async (req: Request): Promise<string | null> => {
		const auth = req.headers.get("authorization");
		if (!auth?.startsWith("Bearer ")) return null;
		try {
			const payload = verifyHS256(auth.slice(7), secret);
			const id = payload.subscriberId;
			return typeof id === "string" && id ? id : null;
		} catch {
			return null;
		}
	};
}

async function parseBody(res: Response): Promise<unknown> {
	return JSON.parse(await res.text());
}

function makeRequest(
	method: string,
	path: string,
	opts: { headers?: Record<string, string>; body?: unknown } = {},
): Request {
	return new Request(`http://localhost${path}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			...(opts.headers ?? {}),
		},
		body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
	});
}

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function createWorkspacePreference(overrides: Partial<PreferenceRecord> = {}): PreferenceRecord {
	return {
		subscriberId: SUBSCRIBER_ID,
		workspaceId: WORKSPACE_ID,
		topicKey: "user.welcome",
		channel: "email",
		enabled: true,
		...overrides,
	};
}

function createWorkspaceDefault(overrides: Partial<WorkspaceDefault> = {}): WorkspaceDefault {
	return {
		workspaceId: WORKSPACE_ID,
		topicKey: "user.welcome",
		channel: "email",
		enabled: true,
		isMandatory: false,
		...overrides,
	};
}

function createWorkspaceIntegration(overrides: Partial<IntegrationRecord> = {}): IntegrationRecord {
	return {
		id: "int_ws_1",
		ownerId: WORKSPACE_ID,
		channel: "email",
		config: { apiKey: "test-key" },
		active: true,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

let preferenceRepo: InMemoryPreferenceRepository;
let defaultRepo: InMemoryWorkspaceDefaultRepository;
let integrationRepo: InMemoryIntegrationRepository;

function makeServer(defaultRole: WorkspaceRole = "admin") {
	const mockEmito = {
		send: vi.fn(),
		start: vi.fn(),
		stop: vi.fn(),
		healthCheck: vi.fn().mockResolvedValue({ healthy: true, providers: [], redis: null }),
		on: vi.fn(),
		off: vi.fn(),
	};

	return createEmitoServer({
		emito: mockEmito as never,
		apiKey: "admin-key",
		resolveSubscriberId: createTestResolveSubscriberId(JWT_SECRET),
		resolveWorkspaceRole: vi.fn().mockResolvedValue(defaultRole),
		repositories: {
			inboxRepository: new InMemoryInboxRepository(),
			preferenceRepository: preferenceRepo,
			consentRepository: new InMemoryConsentRepository(),
			integrationRepository: integrationRepo,
			notificationRepository: new InMemoryNotificationRepository(),
			subscriberRepository: new InMemorySubscriberRepository(),
			deadLetterRepository: new InMemoryDeadLetterRepository(),
			suppressionRepository: new InMemorySuppressionRepository(),
			workspaceDefaultRepository: defaultRepo,
		},
	});
}

beforeEach(() => {
	preferenceRepo = new InMemoryPreferenceRepository();
	defaultRepo = new InMemoryWorkspaceDefaultRepository();
	integrationRepo = new InMemoryIntegrationRepository();
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

async function assertRequiresAuth(method: string, path: string, body?: unknown): Promise<void> {
	const server = makeServer("admin");
	const req = makeRequest(method, path, { body });
	const res = await server.handler(req);
	expect(res.status).toBe(401);
	const b = (await parseBody(res)) as { error: { code: string } };
	expect(b.error.code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_TOKEN);
}

async function assertForbiddenForMember(
	method: string,
	path: string,
	body?: unknown,
): Promise<void> {
	const server = makeServer("member");
	const req = makeRequest(method, path, { headers: authHeader(), body });
	const res = await server.handler(req);
	expect(res.status).toBe(403);
	const b = (await parseBody(res)) as { error: { code: string } };
	expect(b.error.code).toBe(EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE);
}

async function assertForbiddenForNonMember(
	method: string,
	path: string,
	body?: unknown,
): Promise<void> {
	const server = makeServer(null);
	const req = makeRequest(method, path, { headers: authHeader(), body });
	const res = await server.handler(req);
	expect(res.status).toBe(403);
}

// ---------------------------------------------------------------------------
// Workspace Preferences
// ---------------------------------------------------------------------------

describe("GET /emito/v1/workspace/:wsId/preferences", () => {
	it("should return subscriber's preferences in this workspace", async () => {
		preferenceRepo.seed(createWorkspacePreference());

		const server = makeServer("admin");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/preferences`, { headers: authHeader() });
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const b = (await parseBody(res)) as { data: { preferences: unknown[] } };
		expect(Array.isArray(b.data.preferences)).toBe(true);
	});

	it("should allow member role to GET workspace preferences (200)", async () => {
		const server = makeServer("member");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/preferences`, { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	it("should return 403 for non-member (null role)", async () => {
		await assertForbiddenForNonMember("GET", `${WORKSPACE_PATH}/preferences`);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("GET", `${WORKSPACE_PATH}/preferences`);
	});
});

describe("PUT /emito/v1/workspace/:wsId/preferences", () => {
	it("should upsert workspace preference as admin and return 200", async () => {
		const server = makeServer("admin");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/preferences`, {
			headers: authHeader(),
			body: { topicKey: "user.welcome", channel: "email", enabled: false },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	it("should allow member role to PUT own workspace preferences (200)", async () => {
		const server = makeServer("member");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/preferences`, {
			headers: authHeader(),
			body: { topicKey: "user.welcome", channel: "email", enabled: false },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	it("should return 403 for non-member (null role)", async () => {
		await assertForbiddenForNonMember("PUT", `${WORKSPACE_PATH}/preferences`, {
			topicKey: "user.welcome",
			channel: "email",
			enabled: false,
		});
	});

	it("should return 400 when channel is invalid", async () => {
		const server = makeServer("admin");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/preferences`, {
			headers: authHeader(),
			body: { topicKey: "user.welcome", channel: "fax", enabled: true },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(400);
	});

	it("should return 400 when topicKey is missing", async () => {
		const server = makeServer("admin");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/preferences`, {
			headers: authHeader(),
			body: { channel: "email", enabled: true },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(400);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("PUT", `${WORKSPACE_PATH}/preferences`, {
			topicKey: "user.welcome",
			channel: "email",
			enabled: true,
		});
	});
});

// ---------------------------------------------------------------------------
// Workspace Defaults
// ---------------------------------------------------------------------------

describe("GET /emito/v1/workspace/:wsId/defaults", () => {
	it("should return workspace notification defaults", async () => {
		defaultRepo.seed(createWorkspaceDefault());

		const server = makeServer("member");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/defaults`, { headers: authHeader() });
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const b = (await parseBody(res)) as { data: { defaults: unknown[] } };
		expect(Array.isArray(b.data.defaults)).toBe(true);
	});

	it("should allow read access for member role", async () => {
		const server = makeServer("member");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/defaults`, { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	it("should return 403 for non-members", async () => {
		await assertForbiddenForNonMember("GET", `${WORKSPACE_PATH}/defaults`);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("GET", `${WORKSPACE_PATH}/defaults`);
	});
});

describe("PUT /emito/v1/workspace/:wsId/defaults", () => {
	it("should set workspace defaults as admin and return 200", async () => {
		const server = makeServer("admin");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/defaults`, {
			headers: authHeader(),
			body: { topicKey: "user.welcome", channel: "email", enabled: true, isMandatory: false },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	it("should return 403 for member role (workspace admin only)", async () => {
		await assertForbiddenForMember("PUT", `${WORKSPACE_PATH}/defaults`, {
			topicKey: "user.welcome",
			channel: "email",
			enabled: true,
			isMandatory: false,
		});
	});

	it("should return 400 when topicKey is missing", async () => {
		const server = makeServer("admin");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/defaults`, {
			headers: authHeader(),
			body: { channel: "email", enabled: true, isMandatory: false },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(400);
	});

	it("should return 400 when channel is invalid", async () => {
		const server = makeServer("admin");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/defaults`, {
			headers: authHeader(),
			body: { topicKey: "t", channel: "fax", enabled: true, isMandatory: false },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(400);
	});

	it("should return 403 for non-members", async () => {
		await assertForbiddenForNonMember("PUT", `${WORKSPACE_PATH}/defaults`, {
			topicKey: "user.welcome",
			channel: "email",
			enabled: true,
			isMandatory: false,
		});
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("PUT", `${WORKSPACE_PATH}/defaults`, {
			topicKey: "user.welcome",
			channel: "email",
			enabled: true,
			isMandatory: false,
		});
	});
});

// ---------------------------------------------------------------------------
// Workspace Integrations
// ---------------------------------------------------------------------------

describe("GET /emito/v1/workspace/:wsId/integrations", () => {
	it("should return workspace integrations for any member", async () => {
		integrationRepo.seed(createWorkspaceIntegration());

		const server = makeServer("member");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/integrations`, { headers: authHeader() });
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const b = (await parseBody(res)) as { data: { integrations: unknown[] } };
		expect(b.data.integrations).toHaveLength(1);
	});

	it("should not return inactive integrations", async () => {
		integrationRepo.seed(createWorkspaceIntegration({ id: "int_ws_1", active: true }));
		integrationRepo.seed(createWorkspaceIntegration({ id: "int_ws_2", active: false }));

		const server = makeServer("member");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/integrations`, { headers: authHeader() });
		const res = await server.handler(req);

		const b = (await parseBody(res)) as { data: { integrations: Array<{ id: string }> } };
		expect(b.data.integrations).toHaveLength(1);
		expect(b.data.integrations[0]!.id).toBe("int_ws_1");
	});

	it("should strip config field from member response (B-010)", async () => {
		integrationRepo.seed(
			createWorkspaceIntegration({ id: "int_ws_secret", config: { botToken: "xoxb-secret" } }),
		);

		const server = makeServer("member");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/integrations`, { headers: authHeader() });
		const res = await server.handler(req);

		const b = (await parseBody(res)) as { data: { integrations: Array<Record<string, unknown>> } };
		expect(b.data.integrations[0]).not.toHaveProperty("config");
	});

	it("should mask secrets in config for admin response (B-010)", async () => {
		integrationRepo.seed(
			createWorkspaceIntegration({
				id: "int_ws_slack",
				channel: "slack",
				config: { botToken: "xoxb-real-value", signingSecret: "ssec-real-value" },
			}),
		);

		const server = makeServer("admin");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/integrations`, { headers: authHeader() });
		const res = await server.handler(req);

		const b = (await parseBody(res)) as { data: { integrations: Array<Record<string, unknown>> } };
		const config = b.data.integrations[0]!.config as Record<string, unknown>;
		expect(config.botToken).not.toBe("xoxb-real-value");
		expect(config.signingSecret).not.toBe("ssec-real-value");
	});

	it("should return 403 for non-members", async () => {
		await assertForbiddenForNonMember("GET", `${WORKSPACE_PATH}/integrations`);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("GET", `${WORKSPACE_PATH}/integrations`);
	});
});

describe("POST /emito/v1/workspace/:wsId/integrations", () => {
	it("should create a workspace integration as admin and return 201", async () => {
		const server = makeServer("admin");
		const req = makeRequest("POST", `${WORKSPACE_PATH}/integrations`, {
			headers: authHeader(),
			body: { channel: "email", config: { apiKey: "key" } },
		});
		const res = await server.handler(req);

		expect(res.status).toBe(201);
		const b = (await parseBody(res)) as { data: { id: string } };
		expect(b.data.id).toMatch(/^int_/);
	});

	it("should return 403 for member role (workspace admin only)", async () => {
		await assertForbiddenForMember("POST", `${WORKSPACE_PATH}/integrations`, {
			channel: "email",
			config: { apiKey: "key" },
		});
	});

	it("should return 400 when channel is missing", async () => {
		const server = makeServer("admin");
		const req = makeRequest("POST", `${WORKSPACE_PATH}/integrations`, {
			headers: authHeader(),
			body: { config: {} },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(400);
	});

	it("should return 403 for non-members", async () => {
		await assertForbiddenForNonMember("POST", `${WORKSPACE_PATH}/integrations`, {
			channel: "email",
			config: {},
		});
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("POST", `${WORKSPACE_PATH}/integrations`, {
			channel: "email",
			config: {},
		});
	});
});

describe("PUT /emito/v1/workspace/:wsId/integrations/:id", () => {
	it("should update a workspace integration as admin and return 200", async () => {
		integrationRepo.seed(createWorkspaceIntegration({ id: "int_ws_1" }));

		const server = makeServer("admin");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/integrations/int_ws_1`, {
			headers: authHeader(),
			body: { config: { apiKey: "new-key" } },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	it("should return 404 for unknown integration ID", async () => {
		const server = makeServer("admin");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/integrations/int_nope`, {
			headers: authHeader(),
			body: { config: {} },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(404);
	});

	it("should return 403 for member role (workspace admin only)", async () => {
		integrationRepo.seed(createWorkspaceIntegration({ id: "int_ws_1" }));
		await assertForbiddenForMember("PUT", `${WORKSPACE_PATH}/integrations/int_ws_1`, {
			config: {},
		});
	});

	it("should return 403 for non-members", async () => {
		await assertForbiddenForNonMember("PUT", `${WORKSPACE_PATH}/integrations/int_ws_1`, {
			config: {},
		});
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("PUT", `${WORKSPACE_PATH}/integrations/int_ws_1`, { config: {} });
	});
});

describe("POST /emito/v1/workspace/:wsId/integrations/:id/deactivate", () => {
	it("should deactivate a workspace integration as admin and return 200", async () => {
		integrationRepo.seed(createWorkspaceIntegration({ id: "int_ws_1" }));

		const server = makeServer("admin");
		const req = makeRequest("POST", `${WORKSPACE_PATH}/integrations/int_ws_1/deactivate`, {
			headers: authHeader(),
		});
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const active = await integrationRepo.listByWorkspace(WORKSPACE_ID);
		expect(active.find((i) => i.id === "int_ws_1")).toBeUndefined();
	});

	it("should return 404 for unknown integration ID", async () => {
		const server = makeServer("admin");
		const req = makeRequest("POST", `${WORKSPACE_PATH}/integrations/int_nope/deactivate`, {
			headers: authHeader(),
		});
		const res = await server.handler(req);
		expect(res.status).toBe(404);
	});

	it("should return 403 for member role (workspace admin only)", async () => {
		integrationRepo.seed(createWorkspaceIntegration({ id: "int_ws_1" }));
		await assertForbiddenForMember("POST", `${WORKSPACE_PATH}/integrations/int_ws_1/deactivate`);
	});

	it("should return 403 for non-members", async () => {
		await assertForbiddenForNonMember("POST", `${WORKSPACE_PATH}/integrations/int_ws_1/deactivate`);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("POST", `${WORKSPACE_PATH}/integrations/int_ws_1/deactivate`);
	});
});

// ---------------------------------------------------------------------------
// Member Preferences (workspace admin read-only view)
// ---------------------------------------------------------------------------

describe("GET /emito/v1/workspace/:wsId/members/preferences", () => {
	it("should return overview of member preferences as admin", async () => {
		preferenceRepo.seed(createWorkspacePreference({ subscriberId: "sub_1" }));
		preferenceRepo.seed(createWorkspacePreference({ subscriberId: "sub_2" }));

		const server = makeServer("admin");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/members/preferences`, {
			headers: authHeader(),
		});
		const res = await server.handler(req);

		expect(res.status).toBe(200);
		const b = (await parseBody(res)) as { data: { preferences: unknown[] } };
		expect(Array.isArray(b.data.preferences)).toBe(true);
	});

	it("should return 403 for member role (workspace admin only)", async () => {
		await assertForbiddenForMember("GET", `${WORKSPACE_PATH}/members/preferences`);
	});

	it("should return 403 for non-members", async () => {
		await assertForbiddenForNonMember("GET", `${WORKSPACE_PATH}/members/preferences`);
	});

	it("should return 401 without auth", async () => {
		await assertRequiresAuth("GET", `${WORKSPACE_PATH}/members/preferences`);
	});
});

// ---------------------------------------------------------------------------
// wsId validation: must start with ws_
// ---------------------------------------------------------------------------

describe("wsId param validation", () => {
	it("should return 400 when wsId does not have ws_ prefix", async () => {
		const server = makeServer("admin");
		const req = makeRequest("GET", "/emito/v1/workspace/invalid-id/preferences", {
			headers: authHeader(),
		});
		const res = await server.handler(req);
		expect(res.status).toBe(400);
	});
});
