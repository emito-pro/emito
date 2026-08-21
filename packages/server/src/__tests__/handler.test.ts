/**
 * Tests for createEmitoServer — the Web Standard handler, auth wiring, routing,
 * Zod schema validation, workspace auth, and stub routes.
 *
 * After task-1 refactor:
 *   - EmitoServerConfig has resolveSubscriberId (required) instead of jwtSecret
 *   - Subscriber and workspace auth calls resolveSubscriberId(request)
 *   - No JWT branching in handler.ts
 *
 * Rules applied:
 * - Assert on specific EmitoErrorCode values (rule 1)
 * - Assert statusCode for errors crossing API boundary (rule 3)
 * - Follow describe/it naming (rule 15)
 * - Assert on shape of return values (rule 26)
 */

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
import { EMITO_ERROR_CODE } from "@emito/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { WorkspaceRole } from "../auth/workspace-role.js";
import { createEmitoServer } from "../handler.js";

const TEST_API_KEY = "test-admin-api-key-for-handler-tests";

function createMockEmito() {
	return {
		send: vi.fn().mockResolvedValue({ status: "delivered" }),
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue(undefined),
		healthCheck: vi
			.fn()
			.mockResolvedValue({ healthy: true, providers: [], redis: { connected: true } }),
		on: vi.fn(),
		off: vi.fn(),
	};
}

function createRepositories() {
	return {
		subscriberRepository: new InMemorySubscriberRepository(),
		notificationRepository: new InMemoryNotificationRepository(),
		preferenceRepository: new InMemoryPreferenceRepository(),
		consentRepository: new InMemoryConsentRepository(),
		workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
		suppressionRepository: new InMemorySuppressionRepository(),
		deadLetterRepository: new InMemoryDeadLetterRepository(),
		integrationRepository: new InMemoryIntegrationRepository(),
		inboxRepository: new InMemoryInboxRepository(),
	};
}

function makeServer(
	overrides: {
		prefix?: string;
		includeErrorContext?: boolean;
		resolveWorkspaceRole?: (s: string, w: string) => Promise<WorkspaceRole>;
		resolveSubscriberId?: (req: Request) => Promise<string | null>;
	} = {},
) {
	return createEmitoServer({
		emito: createMockEmito() as never,
		apiKey: TEST_API_KEY,
		repositories: createRepositories(),
		prefix: overrides.prefix ?? "/emito",
		includeErrorContext: overrides.includeErrorContext ?? false,
		resolveWorkspaceRole: overrides.resolveWorkspaceRole,
		resolveSubscriberId: overrides.resolveSubscriberId ?? vi.fn().mockResolvedValue("sub_default"),
	});
}

function req(method: string, path: string, headers: Record<string, string> = {}): Request {
	return new Request(`http://localhost${path}`, {
		method,
		headers: { "content-type": "application/json", ...headers },
	});
}

describe("createEmitoServer", () => {
	let server: ReturnType<typeof makeServer>;

	beforeEach(() => {
		server = makeServer();
	});

	describe("404 for unregistered routes", () => {
		it("should return 404 for an unknown path", async () => {
			const res = await server.handler(req("GET", "/emito/v1/does-not-exist"));
			expect(res.status).toBe(404);
			const body = (await res.json()) as { error: { statusCode: number } };
			expect(body.error.statusCode).toBe(404);
		});

		it("should return 404 for a path outside the prefix", async () => {
			const res = await server.handler(req("GET", "/api/health"));
			expect(res.status).toBe(404);
		});
	});

	describe("health endpoint (public auth)", () => {
		it("should return 200 without any auth headers", async () => {
			const res = await server.handler(req("GET", "/emito/health"));
			expect(res.status).toBe(200);
		});

		it("should return JSON content-type", async () => {
			const res = await server.handler(req("GET", "/emito/health"));
			expect(res.headers.get("content-type")).toContain("application/json");
		});

		it("should return a data envelope with health information", async () => {
			const res = await server.handler(req("GET", "/emito/health"));
			const body = (await res.json()) as { data: { healthy: boolean } };
			expect(body.data).toMatchObject({ healthy: true });
		});
	});

	describe("subscriber auth via resolveSubscriberId", () => {
		beforeEach(() => {
			server.addRoute({
				method: "GET",
				pathPattern: "/test-subscriber",
				auth: "subscriber",
				handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
			});
		});

		it("should call resolveSubscriberId for subscriber-scoped routes", async () => {
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_1");
			const s = makeServer({ resolveSubscriberId });
			s.addRoute({
				method: "GET",
				pathPattern: "/test-subscriber",
				auth: "subscriber",
				handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
			});

			const res = await s.handler(req("GET", "/emito/v1/test-subscriber"));
			expect(resolveSubscriberId).toHaveBeenCalled();
			expect(res.status).toBe(200);
		});

		it("should return 401 with AUTH_INVALID_TOKEN when resolveSubscriberId returns null", async () => {
			const s = makeServer({ resolveSubscriberId: vi.fn().mockResolvedValue(null) });
			s.addRoute({
				method: "GET",
				pathPattern: "/test-subscriber",
				auth: "subscriber",
				handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
			});

			const res = await s.handler(req("GET", "/emito/v1/test-subscriber"));
			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_TOKEN);
		});

		it("should return 200 when resolveSubscriberId returns a subscriber ID", async () => {
			const res = await server.handler(req("GET", "/emito/v1/test-subscriber"));
			expect(res.status).toBe(200);
		});

		it("should pass a Web Standard Request to resolveSubscriberId", async () => {
			let capturedReq: Request | null = null;
			const resolveSubscriberId = vi.fn().mockImplementation(async (r: Request) => {
				capturedReq = r;
				return "sub_1";
			});
			const s = makeServer({ resolveSubscriberId });
			s.addRoute({
				method: "GET",
				pathPattern: "/test-subscriber",
				auth: "subscriber",
				handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
			});

			await s.handler(
				req("GET", "/emito/v1/test-subscriber", { authorization: "Bearer some-token" }),
			);

			expect(capturedReq).not.toBeNull();
			expect(capturedReq!.headers.get("authorization")).toBe("Bearer some-token");
		});
	});

	describe("admin API key auth enforcement", () => {
		beforeEach(() => {
			server.addRoute({
				method: "GET",
				pathPattern: "/admin/test",
				auth: "admin",
				handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
			});
		});

		it("should return 401 with AUTH_MISSING_TOKEN when admin key header is absent", async () => {
			const res = await server.handler(req("GET", "/emito/v1/admin/test"));
			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe(EMITO_ERROR_CODE.AUTH_MISSING_TOKEN);
		});

		it("should return 401 with AUTH_INVALID_API_KEY when key is wrong", async () => {
			const res = await server.handler(
				req("GET", "/emito/v1/admin/test", { "x-emito-admin-key": "wrong-key" }),
			);
			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe(EMITO_ERROR_CODE.AUTH_INVALID_API_KEY);
		});

		it("should return 200 when the admin key matches", async () => {
			const res = await server.handler(
				req("GET", "/emito/v1/admin/test", { "x-emito-admin-key": TEST_API_KEY }),
			);
			expect(res.status).toBe(200);
		});
	});

	describe("configurable prefix", () => {
		it("should match routes under a custom prefix", async () => {
			const custom = makeServer({ prefix: "/api/notifications" });
			const res = await custom.handler(req("GET", "/api/notifications/health"));
			expect(res.status).toBe(200);
		});

		it("should not match /emito/health when prefix is /api/notifications", async () => {
			const custom = makeServer({ prefix: "/api/notifications" });
			const res = await custom.handler(req("GET", "/emito/health"));
			expect(res.status).toBe(404);
		});
	});

	describe("API versioning", () => {
		it("exposes the versioned base alongside the mount prefix", () => {
			expect(server.prefix).toBe("/emito");
			expect(server.apiBase).toBe("/emito/v1");
		});

		it("carries the version through a custom mount prefix", () => {
			expect(makeServer({ prefix: "/api/notifications" }).apiBase).toBe("/api/notifications/v1");
		});

		/**
		 * The unversioned set is a deliberate, closed list: operational probes,
		 * links baked into delivered email, and URLs configured in a provider's
		 * console. Anything else must sit behind the version, so this asserts the
		 * exact set rather than merely that it is non-empty — a stray
		 * `unversioned: true` on a wire endpoint has to fail here.
		 */
		it("keeps only the long-lived paths off the version segment", () => {
			// Every optional endpoint group wired on, so the assertion sees the
			// complete surface rather than whatever the default config registers.
			const full = createEmitoServer({
				emito: createMockEmito() as never,
				apiKey: TEST_API_KEY,
				repositories: createRepositories(),
				prefix: "/emito",
				resolveSubscriberId: vi.fn().mockResolvedValue("sub_default"),
				unsubscribeSecret: "test-unsubscribe-secret",
				webhookSecrets: { resend: "test-webhook-secret" },
				listMemberConfirm: { confirm: vi.fn() } as never,
			});

			const unversioned = full.router.routes
				.filter((route) => !route.pathPattern.startsWith("/emito/v1/"))
				.map((route) => route.pathPattern);

			expect([...new Set(unversioned)].sort()).toEqual([
				"/emito/confirm",
				"/emito/health",
				"/emito/metrics",
				"/emito/track/click/:id/:idx",
				"/emito/track/open/:id",
				"/emito/unsubscribe",
				"/emito/webhooks/:provider",
			]);
		});

		it("puts the subscriber wire API behind the version", () => {
			const patterns = server.router.routes.map((route) => route.pathPattern);
			expect(patterns).toContain("/emito/v1/notifications");
			expect(patterns).toContain("/emito/v1/preferences");
			expect(patterns).toContain("/emito/v1/capabilities");
		});
	});

	describe("includeErrorContext flag", () => {
		it("should not expose error context when false (default)", async () => {
			server.addRoute({
				method: "GET",
				pathPattern: "/test-error",
				auth: "public",
				handler: async () => {
					const { EmitoError, EMITO_ERROR_CODE: CODE } = await import("@emito/types");
					throw new EmitoError({
						code: CODE.SUBSCRIBER_NOT_FOUND,
						message: "test error",
						context: { secret: "do-not-expose" },
					});
				},
			});
			const res = await server.handler(req("GET", "/emito/v1/test-error"));
			const body = (await res.json()) as { error: Record<string, unknown> };
			expect(body.error.details).toBeUndefined();
		});

		it("should expose error context when includeErrorContext is true", async () => {
			const devServer = makeServer({ includeErrorContext: true });
			devServer.addRoute({
				method: "GET",
				pathPattern: "/test-error",
				auth: "public",
				handler: async () => {
					const { EmitoError, EMITO_ERROR_CODE: CODE } = await import("@emito/types");
					throw new EmitoError({
						code: CODE.SUBSCRIBER_NOT_FOUND,
						message: "test error",
						context: { hint: "visible-in-dev" },
					});
				},
			});
			const res = await devServer.handler(req("GET", "/emito/v1/test-error"));
			const body = (await res.json()) as { error: Record<string, unknown> };
			expect(body.error.details).toMatchObject({ hint: "visible-in-dev" });
		});
	});

	describe("stub routes return 501", () => {
		it("should return 404 for GET /emito/v1/ws (no longer a stub — implemented as WS upgrade in 005e)", async () => {
			const res = await server.handler(req("GET", "/emito/v1/ws"));
			// /ws is handled via HTTP upgrade, not as a regular route
			expect(res.status).toBe(404);
		});

		it("should return 404 for POST /emito/webhooks/:provider when webhookSecrets not configured", async () => {
			const res = await server.handler(req("POST", "/emito/webhooks/sendgrid"));
			expect(res.status).toBe(404);
		});

		it("should return 200 GIF for GET /emito/track/open/:id (implemented in 005d task-2)", async () => {
			const res = await server.handler(req("GET", "/emito/track/open/ntf_1"));
			// Tracking is now a real endpoint — returns 1x1 GIF pixel (not a stub 501)
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toBe("image/gif");
		});
	});

	describe("Zod schema validation wiring", () => {
		it("should return 400 VALIDATION_ERROR when params schema fails", async () => {
			server.addRoute({
				method: "GET",
				pathPattern: "/typed/:id",
				auth: "public",
				schema: { params: z.object({ id: z.string().startsWith("ntf_") }) },
				handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
			});

			const res = await server.handler(req("GET", "/emito/v1/typed/bad-id"));
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should return 400 VALIDATION_ERROR when query schema fails", async () => {
			server.addRoute({
				method: "GET",
				pathPattern: "/typed-query",
				auth: "public",
				schema: { query: z.object({ limit: z.coerce.number().int().min(1).max(100) }) },
				handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
			});

			const res = await server.handler(req("GET", "/emito/v1/typed-query?limit=9999"));
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should return 400 VALIDATION_ERROR when body schema fails", async () => {
			server.addRoute({
				method: "POST",
				pathPattern: "/typed-body",
				auth: "public",
				schema: { body: z.object({ name: z.string().min(1) }) },
				handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
			});

			const res = await server.handler(
				new Request("http://localhost/emito/v1/typed-body", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "" }),
				}),
			);
			expect(res.status).toBe(400);
		});

		it("should route successfully when all schemas pass", async () => {
			const handler = vi
				.fn()
				.mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }));
			server.addRoute({
				method: "GET",
				pathPattern: "/typed-ok/:id",
				auth: "public",
				schema: { params: z.object({ id: z.string().startsWith("ntf_") }) },
				handler,
			});

			const res = await server.handler(req("GET", "/emito/v1/typed-ok/ntf_abc"));
			expect(res.status).toBe(200);
			expect(handler).toHaveBeenCalledOnce();
		});
	});

	describe("workspace auth wiring", () => {
		it("should call resolveWorkspaceRole for workspace-scoped write routes", async () => {
			const resolveWorkspaceRole = vi.fn().mockResolvedValue("admin");
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_test1");
			const wsServer = makeServer({ resolveWorkspaceRole, resolveSubscriberId });
			wsServer.addRoute({
				method: "PUT",
				pathPattern: "/workspace/:wsId/test",
				auth: "workspace",
				handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
			});

			const res = await wsServer.handler(
				new Request("http://localhost/emito/v1/workspace/ws_1/test", {
					method: "PUT",
					headers: {
						"content-type": "application/json",
					},
				}),
			);

			expect(res.status).toBe(200);
			expect(resolveWorkspaceRole).toHaveBeenCalledWith("sub_test1", "ws_1");
		});

		it("should return 403 when resolveWorkspaceRole returns member for a write", async () => {
			const resolveWorkspaceRole = vi.fn().mockResolvedValue("member");
			const resolveSubscriberId = vi.fn().mockResolvedValue("sub_test1");
			const wsServer = makeServer({ resolveWorkspaceRole, resolveSubscriberId });
			wsServer.addRoute({
				method: "PUT",
				pathPattern: "/workspace/:wsId/test",
				auth: "workspace",
				handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
			});

			const res = await wsServer.handler(
				new Request("http://localhost/emito/v1/workspace/ws_1/test", {
					method: "PUT",
					headers: {
						"content-type": "application/json",
					},
				}),
			);

			expect(res.status).toBe(403);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe(EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE);
		});

		it("should return error when resolveWorkspaceRole is not configured for workspace route", async () => {
			const wsServer = makeServer(); // no resolveWorkspaceRole
			wsServer.addRoute({
				method: "PUT",
				pathPattern: "/workspace/:wsId/test",
				auth: "workspace",
				handler: async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
			});

			const res = await wsServer.handler(
				new Request("http://localhost/emito/v1/workspace/ws_1/test", {
					method: "PUT",
					headers: {
						"content-type": "application/json",
					},
				}),
			);

			expect([400, 500]).toContain(res.status);
		});
	});
});
