/**
 * Task 1 tests: RouteContextFor generic type + central parse in handler.ts
 *
 * Rules applied:
 * - expectTypeOf for compile-time type assertions (rule 29 — don't test TS types at runtime)
 * - Runtime assertions verify parse results are stored in ctx (not discarded)
 * - Assert on shape of return values (rule 26)
 * - Follow describe/it naming (rule 15)
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
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { verifyHS256 } from "../../auth/hs256.js";
import { createEmitoServer } from "../../handler.js";
import type { RouteContextFor } from "../../router.js";
import { createRouter } from "../../router.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_JWT_SECRET = "test-jwt-secret-32-bytes-minimum!!";
const TEST_API_KEY = "test-admin-api-key-for-typed-context-tests";

function buildJwt(subscriberId: string): string {
	const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
	const payload = Buffer.from(
		JSON.stringify({
			subscriberId,
			iat: Math.floor(Date.now() / 1000) - 60,
			exp: Math.floor(Date.now() / 1000) + 3600,
		}),
	).toString("base64url");
	const sig = createHmac("sha256", TEST_JWT_SECRET)
		.update(`${header}.${payload}`)
		.digest("base64url");
	return `${header}.${payload}.${sig}`;
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

function makeServer() {
	return createEmitoServer({
		emito: {
			send: vi.fn().mockResolvedValue({ status: "delivered" }),
			start: vi.fn().mockResolvedValue(undefined),
			stop: vi.fn().mockResolvedValue(undefined),
			healthCheck: vi
				.fn()
				.mockResolvedValue({ healthy: true, providers: [], redis: { connected: true } }),
			on: vi.fn(),
			off: vi.fn(),
		} as never,
		apiKey: TEST_API_KEY,
		resolveSubscriberId: async (req: Request): Promise<string | null> => {
			const auth = req.headers.get("authorization");
			if (!auth?.startsWith("Bearer ")) return null;
			try {
				const payload = verifyHS256(auth.slice(7), TEST_JWT_SECRET);
				const id = payload.subscriberId;
				return typeof id === "string" && id ? id : null;
			} catch {
				return null;
			}
		},
		repositories: createRepositories(),
		prefix: "/emito",
	});
}

// ---------------------------------------------------------------------------
// Schemas used across tests
// ---------------------------------------------------------------------------

const idParamSchema = z.object({ id: z.string().min(1) });
const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) });
const bodySchema = z.object({ name: z.string().min(1) });

// ---------------------------------------------------------------------------
// Compile-time: RouteContextFor type inference
// ---------------------------------------------------------------------------

describe("RouteContextFor", () => {
	describe("subscriber auth + params schema", () => {
		it("infers params.id as string and subscriberId as string (non-optional)", () => {
			// This is a compile-time assertion — if TypeScript fails to infer the shape,
			// this file will fail `tsc --noEmit`.
			type Ctx = RouteContextFor<"subscriber", typeof idParamSchema, undefined, undefined>;

			expectTypeOf<Ctx["params"]["id"]>().toEqualTypeOf<string>();
			expectTypeOf<Ctx["subscriberId"]>().toEqualTypeOf<string>();
		});
	});

	describe("admin auth + no schema", () => {
		it("infers params as Record<string, string> and has no subscriberId", () => {
			type Ctx = RouteContextFor<"admin", undefined, undefined, undefined>;

			expectTypeOf<Ctx["params"]>().toEqualTypeOf<Record<string, string>>();
			// subscriberId must not exist on admin ctx (or be absent/never)
			// We check that it's NOT a string — it should be undefined or not present
			expectTypeOf<Ctx>().not.toHaveProperty("subscriberId");
		});
	});

	describe("public auth + no schema", () => {
		it("infers params as Record<string, string>, query as Record<string, string|string[]>, body as unknown", () => {
			type Ctx = RouteContextFor<"public", undefined, undefined, undefined>;

			expectTypeOf<Ctx["params"]>().toEqualTypeOf<Record<string, string>>();
			expectTypeOf<Ctx["query"]>().toEqualTypeOf<Record<string, string | string[]>>();
			expectTypeOf<Ctx["body"]>().toEqualTypeOf<unknown>();
		});
	});

	describe("workspace auth + params + body schema", () => {
		it("infers typed params, typed body, subscriberId as string, and workspaceRole", () => {
			type Ctx = RouteContextFor<"workspace", typeof idParamSchema, undefined, typeof bodySchema>;

			expectTypeOf<Ctx["params"]["id"]>().toEqualTypeOf<string>();
			expectTypeOf<Ctx["body"]["name"]>().toEqualTypeOf<string>();
			expectTypeOf<Ctx["subscriberId"]>().toEqualTypeOf<string>();
			expectTypeOf<Ctx["workspaceRole"]>().toEqualTypeOf<"admin" | "member" | null>();
		});
	});

	describe("subscriber auth + query schema", () => {
		it("infers typed query.limit as number and subscriberId as string", () => {
			type Ctx = RouteContextFor<"subscriber", undefined, typeof querySchema, undefined>;

			expectTypeOf<Ctx["query"]["limit"]>().toEqualTypeOf<number>();
			expectTypeOf<Ctx["subscriberId"]>().toEqualTypeOf<string>();
		});
	});
});

// ---------------------------------------------------------------------------
// Compile-time: router.add() generic inference
// ---------------------------------------------------------------------------

describe("createRouter generic add()", () => {
	it("accepts a handler typed to RouteContextFor when auth+schema are provided", () => {
		const router = createRouter("/emito", "v1");

		// This must type-check without errors for the test file to compile.
		// The handler receives a fully-typed ctx — if inference is broken, tsc fails here.
		router.add({
			method: "GET",
			pathPattern: "/typed/:id",
			auth: "subscriber",
			schema: { params: idParamSchema },
			handler: async (ctx) => {
				// ctx.params.id must be string, ctx.subscriberId must be string
				const id: string = ctx.params.id;
				const sub: string = ctx.subscriberId;
				return new Response(JSON.stringify({ id, sub }), { status: 200 });
			},
		});
	});

	it("accepts a handler typed to admin ctx with no schema (params: Record<string, string>)", () => {
		const router = createRouter("/emito", "v1");

		router.add({
			method: "GET",
			pathPattern: "/admin/test",
			auth: "admin",
			handler: async (ctx) => {
				// params must be Record<string, string>, no subscriberId
				const params: Record<string, string> = ctx.params;
				return new Response(JSON.stringify({ params }), { status: 200 });
			},
		});
	});
});

// ---------------------------------------------------------------------------
// Runtime: central parse stores results in ctx
// ---------------------------------------------------------------------------

describe("handler.ts central parse — Zod results stored in ctx", () => {
	let server: ReturnType<typeof makeServer>;

	beforeEach(() => {
		server = makeServer();
	});

	describe("params schema", () => {
		it("should store parsed params in ctx (transform applied)", async () => {
			const capturedCtx: { params?: unknown } = {};

			// Use a schema that transforms the value so we can verify parse result is used
			const paramsSchema = z.object({ id: z.string().transform((v) => `transformed_${v}`) });

			server.addRoute({
				method: "GET",
				pathPattern: "/test-params/:id",
				auth: "public",
				schema: { params: paramsSchema },
				handler: async (ctx) => {
					capturedCtx.params = ctx.params;
					return new Response(JSON.stringify({ data: ctx.params }), { status: 200 });
				},
			});

			const res = await server.handler(
				new Request("http://localhost/emito/v1/test-params/abc123", { method: "GET" }),
			);

			expect(res.status).toBe(200);
			// If parse result is stored in ctx, the transform will have been applied
			expect(capturedCtx.params).toMatchObject({ id: "transformed_abc123" });
		});

		it("should still return 400 when params schema fails validation", async () => {
			const paramsSchema = z.object({ id: z.string().startsWith("ntf_") });

			server.addRoute({
				method: "GET",
				pathPattern: "/test-params-fail/:id",
				auth: "public",
				schema: { params: paramsSchema },
				handler: async () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
			});

			const res = await server.handler(
				new Request("http://localhost/emito/v1/test-params-fail/bad", { method: "GET" }),
			);
			expect(res.status).toBe(400);
		});
	});

	describe("query schema", () => {
		it("should store parsed query in ctx (coerce transform applied)", async () => {
			const capturedCtx: { query?: unknown } = {};

			// coerce.number() transforms the string "10" → number 10 — verifies parse result is used
			const schema = z.object({ limit: z.coerce.number().int().min(1).max(100) });

			server.addRoute({
				method: "GET",
				pathPattern: "/test-query",
				auth: "public",
				schema: { query: schema },
				handler: async (ctx) => {
					capturedCtx.query = ctx.query;
					return new Response(JSON.stringify({ data: ctx.query }), { status: 200 });
				},
			});

			const res = await server.handler(
				new Request("http://localhost/emito/v1/test-query?limit=10", { method: "GET" }),
			);

			expect(res.status).toBe(200);
			// If parse result is stored: limit is the number 10 (not string "10")
			expect(capturedCtx.query).toMatchObject({ limit: 10 });
			expect(typeof (capturedCtx.query as Record<string, unknown>).limit).toBe("number");
		});

		it("should still return 400 when query schema fails validation", async () => {
			const schema = z.object({ limit: z.coerce.number().int().min(1).max(100) });

			server.addRoute({
				method: "GET",
				pathPattern: "/test-query-fail",
				auth: "public",
				schema: { query: schema },
				handler: async () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
			});

			const res = await server.handler(
				new Request("http://localhost/emito/v1/test-query-fail?limit=9999", { method: "GET" }),
			);
			expect(res.status).toBe(400);
		});
	});

	describe("body schema", () => {
		it("should store parsed body in ctx (transform applied)", async () => {
			const capturedCtx: { body?: unknown } = {};

			// Transform that uppercases name — verifies parse result is used, not original body
			const schema = z.object({ name: z.string().transform((v) => v.toUpperCase()) });

			server.addRoute({
				method: "POST",
				pathPattern: "/test-body",
				auth: "public",
				schema: { body: schema },
				handler: async (ctx) => {
					capturedCtx.body = ctx.body;
					return new Response(JSON.stringify({ data: ctx.body }), { status: 200 });
				},
			});

			const res = await server.handler(
				new Request("http://localhost/emito/v1/test-body", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "alice" }),
				}),
			);

			expect(res.status).toBe(200);
			// If parse result is stored: name should be uppercased
			expect(capturedCtx.body).toMatchObject({ name: "ALICE" });
		});

		it("should still return 400 when body schema fails validation", async () => {
			const schema = z.object({ name: z.string().min(1) });

			server.addRoute({
				method: "POST",
				pathPattern: "/test-body-fail",
				auth: "public",
				schema: { body: schema },
				handler: async () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
			});

			const res = await server.handler(
				new Request("http://localhost/emito/v1/test-body-fail", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ name: "" }),
				}),
			);
			expect(res.status).toBe(400);
		});
	});

	describe("subscriber auth + typed ctx", () => {
		it("should store subscriberId in ctx and provide typed params from schema", async () => {
			const capturedCtx: { subscriberId?: string; params?: unknown } = {};

			server.router.add({
				method: "GET",
				pathPattern: "/typed-subscriber/:id",
				auth: "subscriber",
				schema: { params: idParamSchema },
				handler: async (ctx) => {
					capturedCtx.subscriberId = ctx.subscriberId;
					capturedCtx.params = ctx.params;
					return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
				},
			});

			const jwt = buildJwt("sub_typed_1");
			const res = await server.handler(
				new Request("http://localhost/emito/v1/typed-subscriber/item_123", {
					method: "GET",
					headers: { authorization: `Bearer ${jwt}` },
				}),
			);

			expect(res.status).toBe(200);
			expect(capturedCtx.subscriberId).toBe("sub_typed_1");
			expect(capturedCtx.params).toMatchObject({ id: "item_123" });
		});
	});

	describe("no schema (passthrough)", () => {
		it("should leave ctx.params as raw Record<string, string> when no params schema", async () => {
			const capturedCtx: { params?: unknown } = {};

			server.addRoute({
				method: "GET",
				pathPattern: "/no-schema/:id",
				auth: "public",
				handler: async (ctx) => {
					capturedCtx.params = ctx.params;
					return new Response(JSON.stringify({ data: ctx.params }), { status: 200 });
				},
			});

			const res = await server.handler(
				new Request("http://localhost/emito/v1/no-schema/raw_value", { method: "GET" }),
			);

			expect(res.status).toBe(200);
			expect(capturedCtx.params).toEqual({ id: "raw_value" });
		});
	});
});

// ---------------------------------------------------------------------------
// Backward compat: RouteContext alias
// ---------------------------------------------------------------------------

describe("RouteContext backward compat alias", () => {
	it("RouteContext is exported and assignable to RouteContextFor<public>", async () => {
		// Verify the export exists at the type level — import will fail to compile if removed
		const { createRouter: cr } = await import("../../router.js");
		expect(cr).toBeDefined();

		// Type check: RouteContext should be assignable to the public alias shape
		// (compile-time only — checked by tsc --noEmit)
		type AssertPublicAlias = import("../../router.js").RouteContext extends RouteContextFor<
			"public",
			undefined,
			undefined,
			undefined
		>
			? true
			: false;
		const _: AssertPublicAlias = true;
		expect(_).toBe(true);
	});
});
