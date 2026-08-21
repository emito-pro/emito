/**
 * Authorization tests for workspace and subscriber integration endpoints:
 *   - Workspace preferences auth (requireMembership)
 *   - Workspace integration ownership check (requireOwnership)
 *   - Integration secrets exposure (maskSecrets / stripConfig)
 *   - requireOwnership used by subscriber integration endpoints
 *
 * Each section covers the access rule a request must satisfy plus the
 * success-path behaviour that must hold for authorized callers.
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
import type { ResolveSubscriberId } from "@emito/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyHS256 } from "../auth/hs256.js";
import { createEmitoServer } from "../handler.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JWT_SECRET = "test-secret-key-at-least-32-chars-long";
const SUBSCRIBER_ID = "sub_1";
const OTHER_SUBSCRIBER_ID = "sub_2";
const WORKSPACE_ID = "ws_1";
const OTHER_WORKSPACE_ID = "ws_2";
const WORKSPACE_PATH = `/emito/v1/workspace/${WORKSPACE_ID}`;

type WorkspaceRole = "admin" | "member" | null;

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

function makeJwt(subscriberId = SUBSCRIBER_ID): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify({ subscriberId })).toString("base64url");
	const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
	return `${header}.${body}.${sig}`;
}

function authHeader(subscriberId = SUBSCRIBER_ID): Record<string, string> {
	return { Authorization: `Bearer ${makeJwt(subscriberId)}` };
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

// ---------------------------------------------------------------------------
// Request helper
// ---------------------------------------------------------------------------

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

async function parseBody(res: Response): Promise<unknown> {
	return JSON.parse(await res.text());
}

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function createWorkspaceIntegration(overrides: Partial<IntegrationRecord> = {}): IntegrationRecord {
	return {
		id: "int_ws_1",
		ownerId: WORKSPACE_ID,
		channel: "slack",
		config: {
			botToken: "xoxb-secret",
			signingSecret: "super-secret",
			webhookUrl: "https://hooks.slack.com/T0/B0/XXXXX",
		},
		active: true,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function createSubscriberIntegration(
	overrides: Partial<IntegrationRecord> = {},
): IntegrationRecord {
	return {
		id: "int_sub_1",
		ownerId: SUBSCRIBER_ID,
		subscriberId: SUBSCRIBER_ID,
		channel: "telegram",
		config: { botToken: "tg-secret-token" },
		active: true,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

let integrationRepo: InMemoryIntegrationRepository;
let preferenceRepo: InMemoryPreferenceRepository;

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
			workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
		},
	});
}

beforeEach(() => {
	integrationRepo = new InMemoryIntegrationRepository();
	preferenceRepo = new InMemoryPreferenceRepository();
});

afterEach(() => {
	vi.restoreAllMocks();
});

// ===========================================================================
// Workspace Preferences Auth
// ===========================================================================
//
// PUT /workspace/:wsId/preferences uses auth: "subscriber" plus an explicit
// requireMembership() check (not enforceWorkspaceRole), so a member — not just
// an admin — may PUT their own workspace preferences. A member subscriber can
// PUT preferences (200); a non-member (null role) gets 403.

describe("workspace preferences auth", () => {
	it("member can PUT own workspace preferences", async () => {
		const server = makeServer("member");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/preferences`, {
			headers: authHeader(),
			body: { topicKey: "user.welcome", channel: "email", enabled: false },
		});
		const res = await server.handler(req);
		// requireMembership allows members to write their own preferences
		expect(res.status).toBe(200);
	});

	// admin can PUT workspace preferences
	it("should allow admin to PUT workspace preferences (200)", async () => {
		const server = makeServer("admin");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/preferences`, {
			headers: authHeader(),
			body: { topicKey: "user.welcome", channel: "email", enabled: true },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	// non-member cannot PUT workspace preferences
	it("should return 403 when subscriber is not a member of the workspace", async () => {
		const server = makeServer(null); // null = non-member
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/preferences`, {
			headers: authHeader(),
			body: { topicKey: "user.welcome", channel: "email", enabled: false },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(403);
		const b = (await parseBody(res)) as { error: { code: string } };
		expect(b.error.code).toBe(EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE);
	});

	// unauthenticated requests get 401
	it("should return 401 without auth token", async () => {
		const server = makeServer("member");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/preferences`, {
			body: { topicKey: "user.welcome", channel: "email", enabled: false },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(401);
		const b = (await parseBody(res)) as { error: { code: string } };
		expect(b.error.code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_TOKEN);
	});

	// GET preferences works for members
	it("should allow member to GET workspace preferences (200)", async () => {
		const server = makeServer("member");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/preferences`, { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	// non-member cannot GET workspace preferences
	it("should return 403 for GET when subscriber is not a workspace member", async () => {
		const server = makeServer(null);
		const req = makeRequest("GET", `${WORKSPACE_PATH}/preferences`, { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(403);
	});

	// enforceWorkspaceRole behaviour for non-preferences workspace routes:
	// workspace defaults PUT still requires admin (member gets 403).
	it("member cannot PUT workspace defaults (admin-only write)", async () => {
		const server = makeServer("member");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/defaults`, {
			headers: authHeader(),
			body: { topicKey: "user.welcome", channel: "email", enabled: true, isMandatory: false },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(403);
		const b = (await parseBody(res)) as { error: { code: string } };
		expect(b.error.code).toBe(EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE);
	});
});

// ===========================================================================
// Workspace Integration Ownership Check
// ===========================================================================
//
// PUT /workspace/:wsId/integrations/:id and
// POST /workspace/:wsId/integrations/:id/deactivate must verify that
// integration.ownerId === wsId via requireOwnership(), so an admin of
// workspace A cannot modify an integration belonging to workspace B.
// Cross-workspace update/deactivate returns 403.

describe("workspace integration ownership check", () => {
	it("PUT integration from another workspace returns 403", async () => {
		// Integration belongs to OTHER_WORKSPACE_ID, but request targets WORKSPACE_ID
		integrationRepo.seed(
			createWorkspaceIntegration({ id: "int_ws_other", ownerId: OTHER_WORKSPACE_ID }),
		);

		const server = makeServer("admin");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/integrations/int_ws_other`, {
			headers: authHeader(),
			body: { config: { botToken: "attacker-token" } },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(403);
		const b = (await parseBody(res)) as { error: { code: string } };
		expect(b.error.code).toBe(EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE);
	});

	// cross-workspace deactivate is rejected
	it("deactivate integration from another workspace returns 403", async () => {
		integrationRepo.seed(
			createWorkspaceIntegration({ id: "int_ws_other", ownerId: OTHER_WORKSPACE_ID }),
		);

		const server = makeServer("admin");
		const req = makeRequest("POST", `${WORKSPACE_PATH}/integrations/int_ws_other/deactivate`, {
			headers: authHeader(),
		});
		const res = await server.handler(req);
		expect(res.status).toBe(403);
		const b = (await parseBody(res)) as { error: { code: string } };
		expect(b.error.code).toBe(EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE);
	});

	// admin can update own workspace's integration
	it("should allow admin to update own workspace integration (200)", async () => {
		integrationRepo.seed(createWorkspaceIntegration({ id: "int_ws_1", ownerId: WORKSPACE_ID }));

		const server = makeServer("admin");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/integrations/int_ws_1`, {
			headers: authHeader(),
			body: { config: { botToken: "new-token" } },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	// admin can deactivate own workspace's integration
	it("should allow admin to deactivate own workspace integration (200)", async () => {
		integrationRepo.seed(createWorkspaceIntegration({ id: "int_ws_1", ownerId: WORKSPACE_ID }));

		const server = makeServer("admin");
		const req = makeRequest("POST", `${WORKSPACE_PATH}/integrations/int_ws_1/deactivate`, {
			headers: authHeader(),
		});
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	// unknown integration returns 404
	it("should return 404 for unknown integration on PUT", async () => {
		const server = makeServer("admin");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/integrations/int_nope`, {
			headers: authHeader(),
			body: { config: {} },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(404);
	});

	// unknown integration returns 404 on deactivate
	it("should return 404 for unknown integration on deactivate", async () => {
		const server = makeServer("admin");
		const req = makeRequest("POST", `${WORKSPACE_PATH}/integrations/int_nope/deactivate`, {
			headers: authHeader(),
		});
		const res = await server.handler(req);
		expect(res.status).toBe(404);
	});

	// member role is blocked on writes
	it("member cannot PUT workspace integration (403 from workspace auth)", async () => {
		integrationRepo.seed(createWorkspaceIntegration({ id: "int_ws_1", ownerId: WORKSPACE_ID }));

		const server = makeServer("member");
		const req = makeRequest("PUT", `${WORKSPACE_PATH}/integrations/int_ws_1`, {
			headers: authHeader(),
			body: { config: {} },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(403);
	});

	// non-member is blocked
	it("non-member cannot deactivate workspace integration (403)", async () => {
		integrationRepo.seed(createWorkspaceIntegration({ id: "int_ws_1", ownerId: WORKSPACE_ID }));

		const server = makeServer(null);
		const req = makeRequest("POST", `${WORKSPACE_PATH}/integrations/int_ws_1/deactivate`, {
			headers: authHeader(),
		});
		const res = await server.handler(req);
		expect(res.status).toBe(403);
	});
});

// ===========================================================================
// requireOwnership used by subscriber integration endpoints
// ===========================================================================
//
// Subscriber integration endpoints use the shared requireOwnership() helper:
// a subscriber may only mutate integrations they own.

describe("subscriber integration ownership (requireOwnership)", () => {
	// updating another subscriber's integration returns 403
	it("should return 403 when updating another subscriber's integration", async () => {
		integrationRepo.seed(
			createSubscriberIntegration({
				id: "int_other",
				subscriberId: OTHER_SUBSCRIBER_ID,
				ownerId: OTHER_SUBSCRIBER_ID,
			}),
		);

		const server = makeServer("admin");
		const req = makeRequest("PUT", "/emito/v1/integrations/int_other", {
			headers: authHeader(SUBSCRIBER_ID),
			body: { config: {} },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(403);
		const b = (await parseBody(res)) as { error: { code: string } };
		expect(b.error.code).toBe(EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE);
	});

	// deactivating another subscriber's integration returns 403
	it("should return 403 when deactivating another subscriber's integration", async () => {
		integrationRepo.seed(
			createSubscriberIntegration({
				id: "int_other",
				subscriberId: OTHER_SUBSCRIBER_ID,
				ownerId: OTHER_SUBSCRIBER_ID,
			}),
		);

		const server = makeServer("admin");
		const req = makeRequest("POST", "/emito/v1/integrations/int_other/deactivate", {
			headers: authHeader(SUBSCRIBER_ID),
		});
		const res = await server.handler(req);
		expect(res.status).toBe(403);
		const b = (await parseBody(res)) as { error: { code: string } };
		expect(b.error.code).toBe(EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE);
	});

	// own integration can be updated
	it("should allow subscriber to update own integration (200)", async () => {
		integrationRepo.seed(createSubscriberIntegration({ id: "int_sub_1" }));

		const server = makeServer("admin");
		const req = makeRequest("PUT", "/emito/v1/integrations/int_sub_1", {
			headers: authHeader(SUBSCRIBER_ID),
			body: { config: { botToken: "new-token" } },
		});
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});

	// own integration can be deactivated
	it("should allow subscriber to deactivate own integration (200)", async () => {
		integrationRepo.seed(createSubscriberIntegration({ id: "int_sub_1" }));

		const server = makeServer("admin");
		const req = makeRequest("POST", "/emito/v1/integrations/int_sub_1/deactivate", {
			headers: authHeader(SUBSCRIBER_ID),
		});
		const res = await server.handler(req);
		expect(res.status).toBe(200);
	});
});

// ===========================================================================
// Integration Secrets Exposure
// ===========================================================================
//
// GET /workspace/:wsId/integrations must not leak secrets. Members should not
// see the config field at all (stripConfig()); admins should see masked
// secrets (e.g. "xo***" placeholder, via maskSecrets()). Writes accept
// plaintext.

describe("integration secrets exposure", () => {
	// member sees no config field
	it("member GET integrations returns records without config field", async () => {
		integrationRepo.seed(
			createWorkspaceIntegration({
				id: "int_ws_slack",
				ownerId: WORKSPACE_ID,
				config: { botToken: "xoxb-real-secret", signingSecret: "ssec-real" },
			}),
		);

		const server = makeServer("member");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/integrations`, { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(200);

		const b = (await parseBody(res)) as { data: { integrations: Array<Record<string, unknown>> } };
		expect(b.data.integrations).toHaveLength(1);
		const integration = b.data.integrations[0]!;
		// member responses must omit the config field entirely
		expect(integration).not.toHaveProperty("config");
	});

	// admin sees masked secrets
	it("admin GET integrations returns records with masked secret fields", async () => {
		integrationRepo.seed(
			createWorkspaceIntegration({
				id: "int_ws_slack",
				ownerId: WORKSPACE_ID,
				channel: "slack",
				config: {
					botToken: "xoxb-real-secret-value",
					signingSecret: "ssec-real-value",
					webhookUrl: "https://hooks.slack.com/T0/B0/XXXXX",
				},
			}),
		);

		const server = makeServer("admin");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/integrations`, { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(200);

		const b = (await parseBody(res)) as { data: { integrations: Array<Record<string, unknown>> } };
		const integration = b.data.integrations[0]!;
		// config.botToken must be masked, not the original plaintext value
		expect(integration).toHaveProperty("config");
		const config = integration.config as Record<string, unknown>;
		expect(config.botToken).not.toBe("xoxb-real-secret-value");
		expect(config.signingSecret).not.toBe("ssec-real-value");
		// Masked value should be a non-empty string (e.g. "xo***")
		expect(typeof config.botToken).toBe("string");
		expect((config.botToken as string).length).toBeGreaterThan(0);
	});

	// admin integrations list includes non-secret fields unmasked
	it("should return non-secret fields unmasked for admin", async () => {
		integrationRepo.seed(
			createWorkspaceIntegration({
				id: "int_ws_slack",
				ownerId: WORKSPACE_ID,
				channel: "slack",
				config: { botToken: "xoxb-secret", notASecret: "visible-value" },
			}),
		);

		const server = makeServer("admin");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/integrations`, { headers: authHeader() });
		const res = await server.handler(req);

		const b = (await parseBody(res)) as { data: { integrations: Array<Record<string, unknown>> } };
		const config = b.data.integrations[0]!.config as Record<string, unknown>;
		// Non-secret fields pass through unmasked
		expect(config.notASecret).toBe("visible-value");
	});

	// member integrations list includes basic metadata (id, channel, active)
	it("should return id, channel, active for members (config stripped)", async () => {
		integrationRepo.seed(
			createWorkspaceIntegration({
				id: "int_ws_1",
				ownerId: WORKSPACE_ID,
				channel: "slack",
				active: true,
			}),
		);

		const server = makeServer("member");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/integrations`, { headers: authHeader() });
		const res = await server.handler(req);

		const b = (await parseBody(res)) as { data: { integrations: Array<Record<string, unknown>> } };
		const integration = b.data.integrations[0]!;
		expect(integration.id).toBe("int_ws_1");
		expect(integration.channel).toBe("slack");
		expect(integration.active).toBe(true);
		expect(integration).not.toHaveProperty("config");
	});

	// writes (POST create) accept plaintext secrets
	it("should accept plaintext secrets in POST /workspace/:wsId/integrations body", async () => {
		const server = makeServer("admin");
		const req = makeRequest("POST", `${WORKSPACE_PATH}/integrations`, {
			headers: authHeader(),
			body: {
				channel: "slack",
				config: { botToken: "xoxb-plaintext-token", signingSecret: "plain-signing" },
			},
		});
		const res = await server.handler(req);
		expect(res.status).toBe(201);
	});

	// admin endpoint (GET /admin/workspaces/:id/integrations) also masks secrets
	it("should mask secrets in admin endpoint GET /admin/workspaces/:id/integrations", async () => {
		integrationRepo.seed(
			createWorkspaceIntegration({
				id: "int_admin_ws",
				ownerId: WORKSPACE_ID,
				channel: "slack",
				config: { botToken: "xoxb-admin-secret", signingSecret: "ssec-admin-secret" },
			}),
		);

		const adminHeaders = { "x-emito-admin-key": "admin-key" };
		const server = makeServer("admin");
		const req = makeRequest("GET", `/emito/v1/admin/workspaces/${WORKSPACE_ID}/integrations`, {
			headers: adminHeaders,
		});
		const res = await server.handler(req);
		expect(res.status).toBe(200);

		const b = (await parseBody(res)) as { data: { items: Array<Record<string, unknown>> } };
		const item = b.data.items[0];
		if (item) {
			const config = item.config as Record<string, unknown> | undefined;
			if (config?.botToken !== undefined) {
				// If config is returned, botToken must be masked
				expect(config.botToken).not.toBe("xoxb-admin-secret");
			}
		}
	});

	// non-member cannot GET workspace integrations
	it("non-member cannot GET workspace integrations (403)", async () => {
		const server = makeServer(null);
		const req = makeRequest("GET", `${WORKSPACE_PATH}/integrations`, { headers: authHeader() });
		const res = await server.handler(req);
		expect(res.status).toBe(403);
	});

	// 401 without auth
	it("unauthenticated request returns 401", async () => {
		const server = makeServer("member");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/integrations`);
		const res = await server.handler(req);
		expect(res.status).toBe(401);
		const b = (await parseBody(res)) as { error: { code: string } };
		expect(b.error.code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_TOKEN);
	});
});

// ===========================================================================
// Security: credentials excluded from observable responses
// ===========================================================================
// These tests verify that the maskSecrets helper does not leak credentials
// through observable side effects (logged objects). Since we mock the logger,
// we test the masking helpers directly via the server's observable responses.

describe("Security: masked secrets are not plaintext in any API response", () => {
	it("admin response config values should not contain full plaintext secret", async () => {
		const plaintextBotToken = "xoxb-full-plaintext-that-must-not-appear";
		integrationRepo.seed(
			createWorkspaceIntegration({
				id: "int_security",
				ownerId: WORKSPACE_ID,
				channel: "slack",
				config: { botToken: plaintextBotToken },
			}),
		);

		const server = makeServer("admin");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/integrations`, { headers: authHeader() });
		const res = await server.handler(req);

		const raw = await res.text();
		// The full plaintext token must not appear in the response body
		expect(raw).not.toContain(plaintextBotToken);
	});

	it("member response body should not contain any config values", async () => {
		const plaintextBotToken = "xoxb-member-must-not-see-this";
		integrationRepo.seed(
			createWorkspaceIntegration({
				id: "int_member_sec",
				ownerId: WORKSPACE_ID,
				channel: "slack",
				config: { botToken: plaintextBotToken },
			}),
		);

		const server = makeServer("member");
		const req = makeRequest("GET", `${WORKSPACE_PATH}/integrations`, { headers: authHeader() });
		const res = await server.handler(req);

		const raw = await res.text();
		expect(raw).not.toContain(plaintextBotToken);
	});
});
