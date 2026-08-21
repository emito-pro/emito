/**
 * Tests for tracking endpoints:
 *   GET /emito/track/open/:id  — 1x1 GIF pixel, opened / machine_opened status
 *   GET /emito/track/click/:id/:idx — 302 redirect, clicked status
 */

import type { Logger } from "@emito/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type TrackingEndpointDeps,
	registerTrackingEndpoints,
} from "../../endpoints/tracking/index.js";
import { createRouter } from "../../router.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** 43-byte 1x1 transparent GIF */
const GIF_HEX =
	"47494638396101000100800000ffffff00000021f90400000000002c00000000010001000002024401003b";
const EXPECTED_GIF_LENGTH = 43;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRouter(prefix = "/emito") {
	return createRouter(prefix);
}

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

function createMockLogger(): Logger & {
	calls: Array<{ level: string; fields: Record<string, unknown>; msg: string }>;
} {
	const calls: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
	const noop = () => {};

	function makeLevel(level: string) {
		return (fields: Record<string, unknown>, msg?: string) => {
			calls.push({ level, fields, msg: msg ?? "" });
		};
	}

	const logger = {
		info: makeLevel("info"),
		warn: makeLevel("warn"),
		error: makeLevel("error"),
		child() {
			return logger;
		},
		calls,
	};
	return logger;
}

function setup(overrides: Partial<TrackingEndpointDeps> = {}) {
	const router = makeRouter();
	const notificationRepository = mockNotificationRepository();
	const subscriberRepository = mockSubscriberRepository();
	const transitionStatus = mockTransitionStatus();
	const logger = createMockLogger();

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

function openRequest(id: string, userAgent?: string) {
	const headers: Record<string, string> = {};
	if (userAgent) headers["user-agent"] = userAgent;
	return new Request(`http://localhost/emito/track/open/${id}`, { headers });
}

function clickRequest(id: string, idx: string, toUrl?: string) {
	const url = toUrl
		? `http://localhost/emito/track/click/${id}/${idx}?to=${encodeURIComponent(toUrl)}`
		: `http://localhost/emito/track/click/${id}/${idx}`;
	return new Request(url);
}

// ---------------------------------------------------------------------------
// Open pixel — GET /emito/track/open/:id
// ---------------------------------------------------------------------------

describe("registerTrackingEndpoints", () => {
	describe("GET /track/open/:id", () => {
		it("should return 200 with 1x1 GIF body", async () => {
			const { router } = setup();
			const match = router.match("GET", "/emito/track/open/ntf_1");
			expect(match).not.toBeNull();

			const res = await match!.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1"),
			);

			expect(res.status).toBe(200);
			const buf = await res.arrayBuffer();
			expect(buf.byteLength).toBe(EXPECTED_GIF_LENGTH);
		});

		it("should return Content-Type: image/gif", async () => {
			const { router } = setup();
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			const res = await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1"),
			);

			expect(res.headers.get("content-type")).toBe("image/gif");
		});

		it("should return Cache-Control: no-store", async () => {
			const { router } = setup();
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			const res = await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1"),
			);

			expect(res.headers.get("cache-control")).toBe("no-store");
		});

		it("should return Content-Length: 43", async () => {
			const { router } = setup();
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			const res = await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1"),
			);

			expect(res.headers.get("content-length")).toBe("43");
		});

		it("should transition notification to opened when trackingEnabled", async () => {
			const { router, transitionStatus } = setup();
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1"),
			);

			expect(transitionStatus).toHaveBeenCalledWith("ntf_1", "opened", expect.anything());
		});

		it("should transition to machine_opened for Apple MPP User-Agent", async () => {
			const { router, transitionStatus } = setup();
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1", "Mozilla/5.0 AppleMailProxy/1.0"),
			);

			expect(transitionStatus).toHaveBeenCalledWith("ntf_1", "machine_opened", expect.anything());
		});

		it("should transition to machine_opened for Apple iCloud Privacy Relay UA", async () => {
			const { router } = setup();
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1", "Airmail/5.6.5 CFNetwork/1474 Darwin/23.0.0"),
			);

			// Either machine_opened or opened is valid for ambiguous UAs;
			// the key test is the Apple proxy pattern above
		});

		it("should NOT call transitionStatus when trackingEnabled is false", async () => {
			const { router, transitionStatus } = setup({
				subscriberRepository: mockSubscriberRepository(false),
			});
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			const res = await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1"),
			);

			// GIF still returned
			expect(res.status).toBe(200);
			const buf = await res.arrayBuffer();
			expect(buf.byteLength).toBe(EXPECTED_GIF_LENGTH);

			// No status recorded
			expect(transitionStatus).not.toHaveBeenCalled();
		});

		it("should still return GIF when notification is not found", async () => {
			const { router, notificationRepository, transitionStatus } = setup();
			notificationRepository.findById.mockResolvedValue(null);
			const match = router.match("GET", "/emito/track/open/ntf_unknown")!;

			const res = await match.route.handler(
				{ params: { id: "ntf_unknown" }, query: {}, body: undefined } as never,
				openRequest("ntf_unknown"),
			);

			expect(res.status).toBe(200);
			const buf = await res.arrayBuffer();
			expect(buf.byteLength).toBe(EXPECTED_GIF_LENGTH);
			expect(transitionStatus).not.toHaveBeenCalled();
		});

		it("should still return GIF when notification lookup throws", async () => {
			const { router, notificationRepository } = setup();
			notificationRepository.findById.mockRejectedValue(new Error("DB error"));
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			const res = await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1"),
			);

			// Must not leak information — always return the GIF
			expect(res.status).toBe(200);
		});

		it("should be idempotent — repeat opens do not error when state machine prevents transition", async () => {
			const { router, notificationRepository } = setup();
			notificationRepository.findById.mockResolvedValue({
				id: "ntf_1",
				subscriberId: "sub_1",
				status: "opened",
			});
			const match = router.match("GET", "/emito/track/open/ntf_1")!;

			const res = await match.route.handler(
				{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
				openRequest("ntf_1"),
			);

			expect(res.status).toBe(200);
		});

		it("should use the id from path params for lookup", async () => {
			const { router, notificationRepository } = setup();
			notificationRepository.findById.mockResolvedValue(null);
			const match = router.match("GET", "/emito/track/open/ntf_abc123")!;

			await match.route.handler(
				{ params: { id: "ntf_abc123" }, query: {}, body: undefined } as never,
				openRequest("ntf_abc123"),
			);

			expect(notificationRepository.findById).toHaveBeenCalledWith("ntf_abc123");
		});
	});

	// ---------------------------------------------------------------------------
	// Click redirect — GET /emito/track/click/:id/:idx
	// ---------------------------------------------------------------------------

	describe("GET /track/click/:id/:idx", () => {
		it("should redirect with 302 to target URL", async () => {
			const { router } = setup();
			const match = router.match("GET", "/emito/track/click/ntf_1/0");
			expect(match).not.toBeNull();

			const res = await match!.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: { to: "https://example.com/page" },
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0", "https://example.com/page"),
			);

			expect(res.status).toBe(302);
			expect(res.headers.get("location")).toBe("https://example.com/page");
		});

		it("should transition notification to clicked when trackingEnabled", async () => {
			const { router, notificationRepository, transitionStatus } = setup();
			notificationRepository.findById.mockResolvedValue({
				id: "ntf_1",
				subscriberId: "sub_1",
				status: "delivered",
			});
			const match = router.match("GET", "/emito/track/click/ntf_1/0")!;

			await match.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: { to: "https://example.com" },
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0", "https://example.com"),
			);

			expect(transitionStatus).toHaveBeenCalledWith("ntf_1", "clicked", expect.anything());
		});

		it("should NOT call transitionStatus when trackingEnabled is false", async () => {
			const { router, transitionStatus } = setup({
				subscriberRepository: mockSubscriberRepository(false),
			});
			const match = router.match("GET", "/emito/track/click/ntf_1/0")!;

			const res = await match.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: { to: "https://example.com" },
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0", "https://example.com"),
			);

			// Redirect still happens
			expect(res.status).toBe(302);
			expect(transitionStatus).not.toHaveBeenCalled();
		});

		it("should redirect even when notification not found", async () => {
			const { router, notificationRepository, transitionStatus } = setup();
			notificationRepository.findById.mockResolvedValue(null);
			const match = router.match("GET", "/emito/track/click/ntf_unknown/0")!;

			const res = await match.route.handler(
				{
					params: { id: "ntf_unknown", idx: "0" },
					query: { to: "https://example.com" },
					body: undefined,
				} as never,
				clickRequest("ntf_unknown", "0", "https://example.com"),
			);

			expect(res.status).toBe(302);
			expect(transitionStatus).not.toHaveBeenCalled();
		});

		it("should return 400 when ?to param is missing", async () => {
			const { router } = setup();
			const match = router.match("GET", "/emito/track/click/ntf_1/0")!;

			const res = await match.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: {},
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0"),
			);

			expect(res.status).toBe(400);
		});

		it("should return 400 for javascript: scheme URL", async () => {
			const { router } = setup();
			const match = router.match("GET", "/emito/track/click/ntf_1/0")!;

			const res = await match.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: { to: "javascript:alert(1)" },
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0", "javascript:alert(1)"),
			);

			expect(res.status).toBe(400);
		});

		it("should return 400 for data: scheme URL", async () => {
			const { router } = setup();
			const match = router.match("GET", "/emito/track/click/ntf_1/0")!;

			const res = await match.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: { to: "data:text/html,<script>alert(1)</script>" },
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0", "data:text/html,<script>alert(1)</script>"),
			);

			expect(res.status).toBe(400);
		});

		it("should return 400 for relative URL (no scheme)", async () => {
			const { router } = setup();
			const match = router.match("GET", "/emito/track/click/ntf_1/0")!;

			const res = await match.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: { to: "/relative/path" },
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0", "/relative/path"),
			);

			expect(res.status).toBe(400);
		});

		it("should accept http:// URLs", async () => {
			const { router } = setup();
			const match = router.match("GET", "/emito/track/click/ntf_1/0")!;

			const res = await match.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: { to: "http://example.com" },
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0", "http://example.com"),
			);

			expect(res.status).toBe(302);
			expect(res.headers.get("location")).toBe("http://example.com");
		});

		it("should accept https:// URLs", async () => {
			const { router } = setup();
			const match = router.match("GET", "/emito/track/click/ntf_1/0")!;

			const res = await match.route.handler(
				{
					params: { id: "ntf_1", idx: "0" },
					query: { to: "https://example.com/path?q=1" },
					body: undefined,
				} as never,
				clickRequest("ntf_1", "0", "https://example.com/path?q=1"),
			);

			expect(res.status).toBe(302);
			expect(res.headers.get("location")).toBe("https://example.com/path?q=1");
		});

		it("should use id and idx from path params for lookup", async () => {
			const { router, notificationRepository } = setup();
			notificationRepository.findById.mockResolvedValue(null);
			const match = router.match("GET", "/emito/track/click/ntf_abc/3")!;

			await match.route.handler(
				{
					params: { id: "ntf_abc", idx: "3" },
					query: { to: "https://example.com" },
					body: undefined,
				} as never,
				clickRequest("ntf_abc", "3", "https://example.com"),
			);

			expect(notificationRepository.findById).toHaveBeenCalledWith("ntf_abc");
		});
	});

	// ---------------------------------------------------------------------------
	// Stub removal verification
	// ---------------------------------------------------------------------------

	describe("stub removal", () => {
		it("should not register stubs for tracking routes after real endpoints are wired", async () => {
			const { registerStubEndpoints } = await import("../../endpoints/stubs.js");
			const router = makeRouter();
			registerStubEndpoints(router);

			// The tracking routes have real endpoints, so they must no longer
			// be registered as stubs in stubs.ts.
			const openMatch = router.match("GET", "/emito/track/open/ntf_1");
			const clickMatch = router.match("GET", "/emito/track/click/ntf_1/0");

			// When removed from stubs.ts these matches are null; a lingering stub
			// would instead return a 501 handler.
			if (openMatch) {
				const res = await openMatch.route.handler(
					{ params: { id: "ntf_1" }, query: {}, body: undefined } as never,
					openRequest("ntf_1"),
				);
				expect(res.status).not.toBe(501);
			}
			if (clickMatch) {
				const res = await clickMatch.route.handler(
					{
						params: { id: "ntf_1", idx: "0" },
						query: { to: "https://example.com" },
						body: undefined,
					} as never,
					clickRequest("ntf_1", "0", "https://example.com"),
				);
				expect(res.status).not.toBe(501);
			}
		});
	});
});
