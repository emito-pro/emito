/**
 * Tests verifying that logger.warn() is called at tracking error catch sites.
 *
 * The open-pixel and click-redirect endpoints swallow notification-lookup
 * failures so a broken tracking row never breaks the pixel/redirect response.
 * These tests assert the swallowed error is still surfaced via logger.warn.
 *
 * Covers:
 * - Logger.warn called when notification lookup throws in open pixel endpoint
 * - Logger.warn called when notification lookup throws in click redirect endpoint
 * - Log fields include notificationId (not PII — email/phone/name/body)
 * - No email, phone, name, or other PII in logged fields
 * - Fields-first format (object arg is the first arg to warn())
 */

import type { Logger } from "@emito/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type TrackingEndpointDeps,
	registerTrackingEndpoints,
} from "../../endpoints/tracking/index.js";
import { createRouter } from "../../router.js";

// ---------------------------------------------------------------------------
// Mock logger (inline — no shared mock file yet in server package)
// ---------------------------------------------------------------------------

type MockLogger = Logger & {
	info: ReturnType<typeof vi.fn>;
	warn: ReturnType<typeof vi.fn>;
	error: ReturnType<typeof vi.fn>;
};

function createMockLogger(): MockLogger {
	const logger: MockLogger = {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child(_bindings: Record<string, unknown>): Logger {
			return logger;
		},
	};
	return logger;
}

// ---------------------------------------------------------------------------
// Repository stubs
// ---------------------------------------------------------------------------

function mockNotificationRepository() {
	return {
		findById: vi.fn().mockResolvedValue({
			id: "ntf_1",
			subscriberId: "sub_1",
			status: "sent",
		}),
		findByProviderMsgId: vi.fn().mockResolvedValue(null),
		create: vi.fn(),
		updateStatus: vi.fn(),
		list: vi.fn(),
		listCrossWorkspace: vi.fn(),
	};
}

function mockSubscriberRepository(trackingEnabled = true) {
	return {
		findById: vi.fn().mockResolvedValue({
			id: "sub_1",
			metadata: { trackingEnabled },
			createdAt: new Date(),
			updatedAt: new Date(),
		}),
		findByIds: vi.fn().mockResolvedValue([]),
		create: vi.fn(),
		upsert: vi.fn(),
		update: vi.fn(),
		list: vi.fn(),
		erase: vi.fn(),
	};
}

function mockTransitionStatus() {
	return vi.fn().mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function setup(
	overrides: Partial<TrackingEndpointDeps> = {},
	loggerOverride?: ReturnType<typeof createMockLogger>,
) {
	const router = createRouter("/emito");
	const notificationRepository = mockNotificationRepository();
	const subscriberRepository = mockSubscriberRepository();
	const transitionStatus = mockTransitionStatus();
	const logger = loggerOverride ?? createMockLogger();

	const deps: TrackingEndpointDeps = {
		notificationRepository,
		subscriberRepository,
		transitionStatus,
		logger,
		...overrides,
	};

	registerTrackingEndpoints(router, deps);

	return { router, notificationRepository, subscriberRepository, transitionStatus, logger, deps };
}

function openRequest(id: string) {
	return new Request(`http://localhost/emito/track/open/${id}`);
}

function clickRequest(id: string, idx: string, toUrl?: string) {
	const url = toUrl
		? `http://localhost/emito/track/click/${id}/${idx}?to=${encodeURIComponent(toUrl)}`
		: `http://localhost/emito/track/click/${id}/${idx}`;
	return new Request(url);
}

// ---------------------------------------------------------------------------
// Open pixel — logger.warn on errors
// ---------------------------------------------------------------------------

describe("registerTrackingEndpoints() — logger calls", () => {
	describe("GET /track/open/:id — logger.warn on error", () => {
		let logger: ReturnType<typeof createMockLogger>;
		let notificationRepository: ReturnType<typeof mockNotificationRepository>;
		let router: ReturnType<typeof createRouter>;

		beforeEach(() => {
			logger = createMockLogger();
			({ router, notificationRepository } = setup({ logger }));
		});

		it("should call logger.warn when notification lookup throws", async () => {
			notificationRepository.findById.mockRejectedValue(new Error("DB error"));
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1"),
			);

			expect(logger.warn).toHaveBeenCalled();
		});

		it("should include notificationId in logger.warn fields when lookup throws", async () => {
			notificationRepository.findById.mockRejectedValue(new Error("DB error"));
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1"),
			);

			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ notificationId: "ntf_1" }),
				expect.any(String),
			);
		});

		it("should use fields-first format: first arg is object, second is string", async () => {
			notificationRepository.findById.mockRejectedValue(new Error("DB error"));
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1"),
			);

			const [fieldsArg, msgArg] = logger.warn.mock.calls[0] as [unknown, unknown];
			expect(typeof fieldsArg).toBe("object");
			expect(fieldsArg).not.toBeNull();
			expect(typeof msgArg).toBe("string");
		});

		it("should NOT log email, phone, or name (no PII in warn fields)", async () => {
			notificationRepository.findById.mockRejectedValue(new Error("DB error"));
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1"),
			);

			for (const call of logger.warn.mock.calls) {
				const fields = call[0] as Record<string, unknown>;
				expect(fields).not.toHaveProperty("email");
				expect(fields).not.toHaveProperty("phone");
				expect(fields).not.toHaveProperty("name");
				expect(fields).not.toHaveProperty("body");
				expect(fields).not.toHaveProperty("apiKey");
				expect(fields).not.toHaveProperty("secret");
				expect(fields).not.toHaveProperty("token");
			}
		});

		it("should NOT call logger.warn when tracking succeeds (no error path)", async () => {
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1"),
			);

			expect(logger.warn).not.toHaveBeenCalled();
		});

		it("should still return GIF (200) even when logger.warn is called", async () => {
			notificationRepository.findById.mockRejectedValue(new Error("DB error"));
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			const res = await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1"),
			);

			expect(res.status).toBe(200);
			expect(logger.warn).toHaveBeenCalled();
		});
	});

	// ---------------------------------------------------------------------------
	// Click redirect — logger.warn on errors
	// ---------------------------------------------------------------------------

	describe("GET /track/click/:id/:idx — logger.warn on error", () => {
		let logger: ReturnType<typeof createMockLogger>;
		let notificationRepository: ReturnType<typeof mockNotificationRepository>;
		let router: ReturnType<typeof createRouter>;

		beforeEach(() => {
			logger = createMockLogger();
			({ router, notificationRepository } = setup({ logger }));
		});

		it("should call logger.warn when notification lookup throws", async () => {
			notificationRepository.findById.mockRejectedValue(new Error("DB error"));
			const match = router.match("GET", "/emito/track/click/ntf_1/0")!;

			await match.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: { to: "https://example.com" },
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0", "https://example.com"),
			);

			expect(logger.warn).toHaveBeenCalled();
		});

		it("should include notificationId in logger.warn fields when lookup throws", async () => {
			notificationRepository.findById.mockRejectedValue(new Error("DB error"));
			const match = router.match("GET", "/emito/track/click/ntf_1/0")!;

			await match.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: { to: "https://example.com" },
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0", "https://example.com"),
			);

			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({ notificationId: "ntf_1" }),
				expect.any(String),
			);
		});

		it("should use fields-first format: first arg is object, second is string", async () => {
			notificationRepository.findById.mockRejectedValue(new Error("DB error"));
			const match = router.match("GET", "/emito/track/click/ntf_1/0")!;

			await match.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: { to: "https://example.com" },
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0", "https://example.com"),
			);

			const [fieldsArg, msgArg] = logger.warn.mock.calls[0] as [unknown, unknown];
			expect(typeof fieldsArg).toBe("object");
			expect(fieldsArg).not.toBeNull();
			expect(typeof msgArg).toBe("string");
		});

		it("should NOT log email, phone, or name (no PII in warn fields)", async () => {
			notificationRepository.findById.mockRejectedValue(new Error("DB error"));
			const match = router.match("GET", "/emito/track/click/ntf_1/0")!;

			await match.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: { to: "https://example.com" },
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0", "https://example.com"),
			);

			for (const call of logger.warn.mock.calls) {
				const fields = call[0] as Record<string, unknown>;
				expect(fields).not.toHaveProperty("email");
				expect(fields).not.toHaveProperty("phone");
				expect(fields).not.toHaveProperty("name");
				expect(fields).not.toHaveProperty("body");
				expect(fields).not.toHaveProperty("apiKey");
				expect(fields).not.toHaveProperty("secret");
				expect(fields).not.toHaveProperty("token");
			}
		});

		it("should NOT call logger.warn when click tracking succeeds (no error path)", async () => {
			const match = router.match("GET", "/emito/track/click/ntf_1/0")!;

			await match.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: { to: "https://example.com" },
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0", "https://example.com"),
			);

			expect(logger.warn).not.toHaveBeenCalled();
		});

		it("should still redirect (302) even when logger.warn is called", async () => {
			notificationRepository.findById.mockRejectedValue(new Error("DB error"));
			const match = router.match("GET", "/emito/track/click/ntf_1/0")!;

			const res = await match.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: { to: "https://example.com" },
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0", "https://example.com"),
			);

			expect(res.status).toBe(302);
			expect(logger.warn).toHaveBeenCalled();
		});
	});
});
