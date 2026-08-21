/**
 * Dead letter retry race — reproduction + verification tests
 *
 * Reproduction test:
 *   Proves the race window exists without the "retrying" intermediate state.
 *   Simulates two concurrent retries that both pass the resolved check because
 *   neither has set any state yet — both see an unresolved record and both call send().
 *
 * Fix verification tests:
 *   The retry handler sets "retrying" BEFORE calling emito.send(). A second concurrent
 *   retry sees "retrying" and gets 409. On send failure, unresolve() clears the state
 *   so a future retry can proceed.
 */

import type { Emito, SendResult } from "@emito/core";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmitoServer } from "../../handler.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_KEY = "test-admin-key-for-dlq-race-tests!!";
const PREFIX = "/emito";
/** Versioned API base — `prefix` is the mount path, routes live under it. */
const API_BASE = `${PREFIX}/v1`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAdminRequest(method: string, path: string): Request {
	return new Request(`http://localhost${API_BASE}${path}`, {
		method,
		headers: { "x-emito-admin-key": ADMIN_KEY },
	});
}

async function parseJson(res: Response): Promise<unknown> {
	return JSON.parse(await res.text());
}

function makeServer(mockEmito: Emito) {
	const deadLetterRepo = new InMemoryDeadLetterRepository();
	const server = createEmitoServer({
		emito: mockEmito,
		apiKey: ADMIN_KEY,
		resolveSubscriberId: async () => null,
		prefix: PREFIX,
		repositories: {
			subscriberRepository: new InMemorySubscriberRepository(),
			notificationRepository: new InMemoryNotificationRepository(),
			deadLetterRepository: deadLetterRepo,
			suppressionRepository: new InMemorySuppressionRepository(),
			integrationRepository: new InMemoryIntegrationRepository(),
			workspaceDefaultRepository: new InMemoryWorkspaceDefaultRepository(),
			inboxRepository: new InMemoryInboxRepository(),
			preferenceRepository: new InMemoryPreferenceRepository(),
			consentRepository: new InMemoryConsentRepository(),
		},
	});
	return { server, deadLetterRepo };
}

function buildDeadLetterData() {
	return {
		notificationId: "ntf_1",
		subscriberId: "sub_1",
		eventType: "order.placed",
		channel: "email" as const,
		attempts: [
			{
				provider: "sendgrid",
				timestamp: new Date("2026-01-01T00:00:00Z"),
				errorCode: "PROVIDER_TIMEOUT",
				errorMessage: "Connection timed out",
			},
		],
		payload: { subject: "Your order" },
	};
}

// ---------------------------------------------------------------------------
// Reproduction test: proves the race window exists WITHOUT the fix
//
// Without "retrying" intermediate state, two concurrent retries can both:
//   1. Call findById() and see resolvedAt = undefined
//   2. Proceed past the resolved check
//   3. Both call emito.send() — double-send
//
// This test directly simulates the pre-fix behavior by bypassing the HTTP
// endpoint and operating directly on the repository + a naive retry function
// that does NOT set intermediate state.
// ---------------------------------------------------------------------------

describe("retry race window without intermediate state", () => {
	it("should demonstrate that two concurrent retries without intermediate state both call send()", async () => {
		const repo = new InMemoryDeadLetterRepository();
		const dl = await repo.create(buildDeadLetterData());

		let sendCallCount = 0;
		const send = async () => {
			sendCallCount++;
			// Simulate async send latency — yields to allow concurrent retry to proceed
			await Promise.resolve();
		};

		// Pre-fix retry logic: checks resolvedAt only, no intermediate "retrying" state
		const retryWithoutFix = async (id: string) => {
			const record = await repo.findById(id);
			if (!record) throw new Error("Not found");
			// BUG: only checks resolvedAt — does NOT check or set intermediate state
			if (record.resolvedAt) throw new Error("Already resolved");

			// Race window: both retries pass this check before either sets state
			await send();
			await repo.resolve(id, "retried");
		};

		// Simulate two concurrent retries — both start before either finishes
		const [result1, result2] = await Promise.allSettled([
			retryWithoutFix(dl.id),
			retryWithoutFix(dl.id),
		]);

		// Without the fix, BOTH retries proceed and send is called twice
		// (demonstrating the bug: double-send due to the race window)
		expect(sendCallCount).toBe(2);

		// Both succeed from the naive retry's perspective
		expect(result1.status).toBe("fulfilled");
		expect(result2.status).toBe("fulfilled");
	});
});

// ---------------------------------------------------------------------------
// Fix verification: endpoint sets "retrying" before send
// ---------------------------------------------------------------------------

describe("retry handler sets 'retrying' before send", () => {
	let deadLetterRepo: InMemoryDeadLetterRepository;
	let mockEmito: Emito;
	let handler: (req: Request) => Promise<Response>;

	beforeEach(() => {
		mockEmito = {
			send: vi.fn().mockResolvedValue({ results: [] }),
			start: vi.fn(),
			stop: vi.fn(),
			healthCheck: vi.fn().mockResolvedValue({ healthy: true, providers: [] }),
			on: vi.fn(),
			off: vi.fn(),
			getEventNames: vi.fn().mockReturnValue([]),
			getEvent: vi.fn(),
		};
		const ctx = makeServer(mockEmito);
		deadLetterRepo = ctx.deadLetterRepo;
		handler = ctx.server.handler;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should set resolution to 'retrying' before calling emito.send()", async () => {
		const dl = await deadLetterRepo.create(buildDeadLetterData());

		let stateBeforeSend: string | undefined;
		vi.mocked(mockEmito.send).mockImplementation(async () => {
			// Capture state mid-send — the record should already be "retrying"
			const record = await deadLetterRepo.findById(dl.id);
			stateBeforeSend = record?.resolution;
			return { notificationId: "ntf_retry_001", channels: [] };
		});

		const res = await handler(makeAdminRequest("POST", `/admin/dead-letters/${dl.id}/retry`));
		expect(res.status).toBe(200);

		// Prove "retrying" was set before send() was called
		expect(stateBeforeSend).toBe("retrying");
	});

	it("should set resolution to 'retried' after successful send", async () => {
		const dl = await deadLetterRepo.create(buildDeadLetterData());

		const res = await handler(makeAdminRequest("POST", `/admin/dead-letters/${dl.id}/retry`));
		expect(res.status).toBe(200);
		const body = (await parseJson(res)) as { data: { resolution: string } };
		expect(body.data.resolution).toBe("retried");

		const record = await deadLetterRepo.findById(dl.id);
		expect(record?.resolution).toBe("retried");
		expect(record?.resolvedAt).toBeDefined();
	});

	it("should block concurrent retry with 409 RESOURCE_CONFLICT when 'retrying' state is set", async () => {
		const dl = await deadLetterRepo.create(buildDeadLetterData());

		// Simulate another retry already in progress — record shows "retrying"
		await deadLetterRepo.resolve(dl.id, "retrying");

		const res = await handler(makeAdminRequest("POST", `/admin/dead-letters/${dl.id}/retry`));
		expect(res.status).toBe(409);
		const body = (await parseJson(res)) as { error: { code: string } };
		expect(body.error.code).toBe(EMITO_ERROR_CODE.RESOURCE_CONFLICT);
	});

	it("should block retry with 409 when already resolved as 'retried'", async () => {
		const dl = await deadLetterRepo.create(buildDeadLetterData());
		await deadLetterRepo.resolve(dl.id, "retried");

		const res = await handler(makeAdminRequest("POST", `/admin/dead-letters/${dl.id}/retry`));
		expect(res.status).toBe(409);
		const body = (await parseJson(res)) as { error: { code: string } };
		expect(body.error.code).toBe(EMITO_ERROR_CODE.RESOURCE_CONFLICT);
	});

	it("should block retry with 409 when already resolved as 'discarded'", async () => {
		const dl = await deadLetterRepo.create(buildDeadLetterData());
		await deadLetterRepo.resolve(dl.id, "discarded");

		const res = await handler(makeAdminRequest("POST", `/admin/dead-letters/${dl.id}/retry`));
		expect(res.status).toBe(409);
		const body = (await parseJson(res)) as { error: { code: string } };
		expect(body.error.code).toBe(EMITO_ERROR_CODE.RESOURCE_CONFLICT);
	});

	it("should unresolve (clear state) when emito.send() throws — failure path", async () => {
		const dl = await deadLetterRepo.create(buildDeadLetterData());
		vi.mocked(mockEmito.send).mockRejectedValueOnce(new Error("provider down"));

		const res = await handler(makeAdminRequest("POST", `/admin/dead-letters/${dl.id}/retry`));
		expect(res.status).toBeGreaterThanOrEqual(500);

		// State must be cleared — record is unresolved so future retries can proceed
		const record = await deadLetterRepo.findById(dl.id);
		expect(record?.resolvedAt).toBeUndefined();
		expect(record?.resolution).toBeUndefined();
	});

	it("should allow a retry after a previous retry failed (unresolve restores state)", async () => {
		const dl = await deadLetterRepo.create(buildDeadLetterData());

		// First retry fails
		vi.mocked(mockEmito.send).mockRejectedValueOnce(new Error("transient error"));
		const firstRes = await handler(makeAdminRequest("POST", `/admin/dead-letters/${dl.id}/retry`));
		expect(firstRes.status).toBeGreaterThanOrEqual(500);

		// Second retry should succeed (record is unresolved after unresolve())
		vi.mocked(mockEmito.send).mockResolvedValueOnce({
			notificationId: "ntf_retry_001",
			channels: [],
		});
		const secondRes = await handler(makeAdminRequest("POST", `/admin/dead-letters/${dl.id}/retry`));
		expect(secondRes.status).toBe(200);
		const body = (await parseJson(secondRes)) as { data: { resolution: string } };
		expect(body.data.resolution).toBe("retried");
	});

	it("should prevent double-send when two retries race — second gets 409", async () => {
		const dl = await deadLetterRepo.create(buildDeadLetterData());

		// Simulate the race: first retry is mid-send (state is "retrying"), second retry arrives
		let firstResolve!: () => void;
		vi.mocked(mockEmito.send).mockImplementationOnce(
			() =>
				new Promise<SendResult>((resolve) => {
					firstResolve = () => resolve({ notificationId: "ntf_retry_001", channels: [] });
				}),
		);

		// Start first retry — it sets "retrying" and pauses mid-send
		const firstRetryPromise = handler(
			makeAdminRequest("POST", `/admin/dead-letters/${dl.id}/retry`),
		);

		// Yield so the first retry can reach resolve("retrying") before the second starts
		await Promise.resolve();
		await Promise.resolve();

		// Second retry arrives while first is still mid-send
		const secondRes = await handler(makeAdminRequest("POST", `/admin/dead-letters/${dl.id}/retry`));

		// Second retry must be blocked
		expect(secondRes.status).toBe(409);
		const body = (await parseJson(secondRes)) as { error: { code: string } };
		expect(body.error.code).toBe(EMITO_ERROR_CODE.RESOURCE_CONFLICT);

		// emito.send called only ONCE — no double-send
		expect(vi.mocked(mockEmito.send)).toHaveBeenCalledTimes(1);

		// Let first retry complete
		firstResolve();
		const firstRes = await firstRetryPromise;
		expect(firstRes.status).toBe(200);
	});

	it("should return 404 for unknown dead letter id — non-retryable", async () => {
		const res = await handler(makeAdminRequest("POST", "/admin/dead-letters/dlq_unknown/retry"));
		expect(res.status).toBe(404);
		const body = (await parseJson(res)) as { error: { code: string } };
		expect(body.error.code).toBe(EMITO_ERROR_CODE.DEAD_LETTER_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// Fix verification: InMemoryDeadLetterRepository.unresolve()
// ---------------------------------------------------------------------------

describe("InMemoryDeadLetterRepository.unresolve()", () => {
	it("should clear resolvedAt and resolution fields", async () => {
		const repo = new InMemoryDeadLetterRepository();
		const dl = await repo.create(buildDeadLetterData());

		await repo.resolve(dl.id, "retrying");
		let record = await repo.findById(dl.id);
		expect(record?.resolution).toBe("retrying");
		expect(record?.resolvedAt).toBeDefined();

		await repo.unresolve(dl.id);
		record = await repo.findById(dl.id);
		expect(record?.resolvedAt).toBeUndefined();
		expect(record?.resolution).toBeUndefined();
	});

	it("should preserve all other fields when unresolving", async () => {
		const repo = new InMemoryDeadLetterRepository();
		const dl = await repo.create(buildDeadLetterData());

		await repo.resolve(dl.id, "retrying");
		await repo.unresolve(dl.id);

		const record = await repo.findById(dl.id);
		expect(record?.id).toBe(dl.id);
		expect(record?.notificationId).toBe("ntf_1");
		expect(record?.subscriberId).toBe("sub_1");
		expect(record?.eventType).toBe("order.placed");
		expect(record?.channel).toBe("email");
		expect(record?.payload).toEqual({ subject: "Your order" });
	});

	it("should allow re-resolve after unresolve", async () => {
		const repo = new InMemoryDeadLetterRepository();
		const dl = await repo.create(buildDeadLetterData());

		await repo.resolve(dl.id, "retrying");
		await repo.unresolve(dl.id);
		await repo.resolve(dl.id, "retried");

		const record = await repo.findById(dl.id);
		expect(record?.resolution).toBe("retried");
		expect(record?.resolvedAt).toBeDefined();
	});

	it("should throw when unresolving a non-existent id", async () => {
		const repo = new InMemoryDeadLetterRepository();
		await expect(repo.unresolve("dlq_nonexistent")).rejects.toThrow();
	});
});
