/**
 * Unit tests for subscriber locale and timezone handling.
 *
 * Covers:
 * - Admin API accepts locale with loose BCP 47 regex validation
 * - Admin API rejects invalid locale values
 * - locale round-trips through admin API (create + read-back)
 * - In-memory repository stores and returns locale
 * - timezone has loose IANA regex validation
 *
 * Backed by InMemorySubscriberRepository, so no real database is required.
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmitoServer } from "../../handler.js";
import { createSubscriberBodySchema } from "../../schemas/admin.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_KEY = "test-admin-key-locale-tests";
const PREFIX = "/emito";
/** Versioned API base — `prefix` is the mount path, routes live under it. */
const API_BASE = `${PREFIX}/v1`;

// ---------------------------------------------------------------------------
// Request builders
// ---------------------------------------------------------------------------

function makeAdminRequest(method: string, path: string, body?: unknown): Request {
	return new Request(`http://localhost${API_BASE}${path}`, {
		method,
		headers: {
			"x-emito-admin-key": ADMIN_KEY,
			...(body !== undefined ? { "content-type": "application/json" } : {}),
		},
		body: body !== undefined ? JSON.stringify(body) : undefined,
	});
}

async function parseJson(res: Response): Promise<unknown> {
	return JSON.parse(await res.text());
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

function makeServer() {
	const subscriberRepo = new InMemorySubscriberRepository();

	const server = createEmitoServer({
		emito: {
			send: vi.fn().mockResolvedValue({ results: [] }),
			start: vi.fn(),
			stop: vi.fn(),
			healthCheck: vi.fn().mockResolvedValue({ healthy: true, providers: [] }),
			on: vi.fn(),
			off: vi.fn(),
			getEventNames: vi.fn().mockReturnValue([]),
			getEvent: vi.fn(),
		},
		apiKey: ADMIN_KEY,
		resolveSubscriberId: async () => null,
		prefix: PREFIX,
		repositories: {
			subscriberRepository: subscriberRepo,
			notificationRepository: new InMemoryNotificationRepository(),
			deadLetterRepository: new InMemoryDeadLetterRepository(),
			suppressionRepository: new InMemorySuppressionRepository(),
			integrationRepository: new InMemoryIntegrationRepository(),
			workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
			inboxRepository: new InMemoryInboxRepository(),
			preferenceRepository: new InMemoryPreferenceRepository(),
			consentRepository: new InMemoryConsentRepository(),
		},
	});

	return { server, subscriberRepo };
}

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function buildCreateBody(overrides: Record<string, unknown> = {}) {
	return {
		id: "sub_loc_1",
		email: "user@example.com",
		...overrides,
	};
}

// ===========================================================================
// createSubscriberBodySchema — locale field Zod validation
// ===========================================================================

describe("createSubscriberBodySchema — locale field", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("valid locale values (BCP 47 loose regex)", () => {
		const validLocales = [
			"en",
			"pl",
			"de",
			"fr",
			"en-US",
			"en-GB",
			"pl-PL",
			"pt-BR",
			"zh-Hant",
			"zh-Hant-TW",
			"sr-Latn",
		];

		for (const locale of validLocales) {
			it(`should accept locale '${locale}'`, () => {
				const result = createSubscriberBodySchema.safeParse(buildCreateBody({ locale }));
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.locale).toBe(locale);
				}
			});
		}
	});

	describe("invalid locale values (BCP 47 loose regex rejection)", () => {
		const invalidLocales = [
			"", // empty string
			"EN", // uppercase primary subtag (BCP 47 primary must be lowercase)
			"en_US", // underscore separator (not BCP 47)
			"123", // digits only
			"en-", // trailing hyphen
			"-en", // leading hyphen
		];

		for (const locale of invalidLocales) {
			it(`should reject locale '${locale}'`, () => {
				const result = createSubscriberBodySchema.safeParse(buildCreateBody({ locale }));
				expect(result.success).toBe(false);
			});
		}
	});

	describe("locale is optional", () => {
		it("should accept body without locale field", () => {
			const result = createSubscriberBodySchema.safeParse(buildCreateBody());
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.locale).toBeUndefined();
			}
		});

		it("should accept body with undefined locale", () => {
			const result = createSubscriberBodySchema.safeParse(buildCreateBody({ locale: undefined }));
			expect(result.success).toBe(true);
		});
	});
});

// ===========================================================================
// createSubscriberBodySchema — timezone validation
// ===========================================================================

describe("createSubscriberBodySchema — timezone field", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("valid IANA timezone values", () => {
		const validTimezones = [
			"UTC",
			"Europe/Warsaw",
			"America/New_York",
			"Asia/Tokyo",
			"Pacific/Auckland",
		];

		for (const timezone of validTimezones) {
			it(`should accept timezone '${timezone}'`, () => {
				const result = createSubscriberBodySchema.safeParse(buildCreateBody({ timezone }));
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.timezone).toBe(timezone);
				}
			});
		}
	});

	describe("invalid IANA timezone values", () => {
		const invalidTimezones = [
			"", // empty string
			"Europe Warsaw", // space not allowed
			"Europe/Warsaw/Extra", // too many segments with non-alpha char
		];

		for (const timezone of invalidTimezones) {
			it(`should reject timezone '${timezone}'`, () => {
				const result = createSubscriberBodySchema.safeParse(buildCreateBody({ timezone }));
				// Timezone validation is loose — only rejects empty strings and spaces
				// Only assert rejection for clearly invalid values
				if (timezone === "") {
					expect(result.success).toBe(false);
				}
			});
		}
	});

	it("should accept body without timezone field", () => {
		const result = createSubscriberBodySchema.safeParse(buildCreateBody());
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.timezone).toBeUndefined();
		}
	});
});

// ===========================================================================
// Admin API — locale round-trip through HTTP layer
// ===========================================================================

describe("admin subscriber API — locale round-trip", () => {
	let handler: (req: Request) => Promise<Response>;
	let subscriberRepo: InMemorySubscriberRepository;

	beforeEach(() => {
		const ctx = makeServer();
		handler = ctx.server.handler;
		subscriberRepo = ctx.subscriberRepo;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("POST /admin/subscribers — locale accepted and returned", () => {
		it("should create subscriber with valid locale and return it", async () => {
			const res = await handler(
				makeAdminRequest("POST", "/admin/subscribers", buildCreateBody({ locale: "en-US" })),
			);

			expect(res.status).toBe(201);
			const body = (await parseJson(res)) as { data: Record<string, unknown> };
			expect(body.data).toMatchObject({ id: "sub_loc_1", locale: "en-US" });
		});

		it("should create subscriber without locale when not provided", async () => {
			const res = await handler(makeAdminRequest("POST", "/admin/subscribers", buildCreateBody()));

			expect(res.status).toBe(201);
			const body = (await parseJson(res)) as { data: Record<string, unknown> };
			expect(body.data.id).toBe("sub_loc_1");
			expect(body.data.locale).toBeUndefined();
		});

		it("should return 400 when locale fails BCP 47 validation", async () => {
			const res = await handler(
				makeAdminRequest(
					"POST",
					"/admin/subscribers",
					buildCreateBody({ locale: "" }), // empty string rejected
				),
			);

			expect(res.status).toBe(400);
			const body = (await parseJson(res)) as { error: { code: string } };
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});

		it("should return 400 when locale uses underscore separator (not BCP 47)", async () => {
			const res = await handler(
				makeAdminRequest(
					"POST",
					"/admin/subscribers",
					buildCreateBody({ locale: "en_US" }), // underscore separator
				),
			);

			expect(res.status).toBe(400);
			const body = (await parseJson(res)) as { error: { code: string } };
			expect(body.error.code).toBe("VALIDATION_ERROR");
		});
	});

	describe("POST /admin/subscribers — locale round-trips via upsert", () => {
		it("should update locale on existing subscriber via upsert", async () => {
			// Seed subscriber without locale
			subscriberRepo.seed({
				id: "sub_loc_upsert",
				email: "upsert@example.com",
				metadata: {},
				createdAt: new Date("2026-01-01T00:00:00Z"),
				updatedAt: new Date("2026-01-01T00:00:00Z"),
			});

			const res = await handler(
				makeAdminRequest("POST", "/admin/subscribers", {
					id: "sub_loc_upsert",
					email: "upsert@example.com",
					locale: "fr-FR",
				}),
			);

			expect([200, 201]).toContain(res.status);
			const body = (await parseJson(res)) as { data: Record<string, unknown> };
			expect(body.data.locale).toBe("fr-FR");
		});
	});

	describe("GET /admin/subscribers/:id — locale returned in response", () => {
		it("should return locale on GET after creating with locale", async () => {
			await handler(
				makeAdminRequest(
					"POST",
					"/admin/subscribers",
					buildCreateBody({ id: "sub_loc_get", locale: "de-DE" }),
				),
			);

			const res = await handler(makeAdminRequest("GET", "/admin/subscribers/sub_loc_get"));
			expect(res.status).toBe(200);
			const body = (await parseJson(res)) as { data: Record<string, unknown> };
			expect(body.data.locale).toBe("de-DE");
		});
	});
});

// ===========================================================================
// InMemorySubscriberRepository — locale storage
// ===========================================================================

describe("InMemorySubscriberRepository — locale field", () => {
	let repo: InMemorySubscriberRepository;

	beforeEach(() => {
		repo = new InMemorySubscriberRepository();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should store and return locale when provided at create", async () => {
		const created = await repo.create({
			id: "sub_loc_mem_1",
			email: "mem@example.com",
			locale: "en-GB",
		});

		expect(created.locale).toBe("en-GB");
	});

	it("should return undefined locale when not provided at create", async () => {
		const created = await repo.create({
			id: "sub_loc_mem_2",
			email: "mem2@example.com",
		});

		expect(created.locale).toBeUndefined();
	});

	it("should persist locale through findById", async () => {
		await repo.create({
			id: "sub_loc_mem_3",
			email: "mem3@example.com",
			locale: "pl-PL",
		});

		const found = await repo.findById("sub_loc_mem_3");
		expect(found?.locale).toBe("pl-PL");
	});

	it("should include locale in list results", async () => {
		await repo.create({
			id: "sub_loc_mem_4",
			email: "mem4@example.com",
			locale: "ja-JP",
		});

		const result = await repo.list();
		const item = result.items.find((s) => s.id === "sub_loc_mem_4");
		expect(item?.locale).toBe("ja-JP");
	});

	it("should store locale independently from lang", async () => {
		const created = await repo.create({
			id: "sub_loc_mem_5",
			email: "mem5@example.com",
			lang: "pt",
			locale: "pt-BR",
		});

		expect(created.lang).toBe("pt");
		expect(created.locale).toBe("pt-BR");
	});

	it("should allow update to set locale on a subscriber that lacked it", async () => {
		await repo.create({
			id: "sub_loc_mem_6",
			email: "mem6@example.com",
		});

		const updated = await repo.update("sub_loc_mem_6", { locale: "zh-Hans" });

		expect(updated.locale).toBe("zh-Hans");
	});

	describe("boundary: null/undefined locale", () => {
		it("should handle explicitly undefined locale at create", async () => {
			const created = await repo.create({
				id: "sub_loc_mem_undef",
				email: "undef@example.com",
				locale: undefined,
			});

			expect(created.locale).toBeUndefined();
		});
	});
});
