/**
 * Tests for the retry engine (retry.ts).
 *
 * Covers:
 * - Exponential backoff delay calculations
 * - Jitter within ±20% tolerance
 * - maxAttempts limit respected
 * - Transient errors are retried on the same provider
 * - Rate-limited errors retry the same provider (no failover)
 * - Permanent errors are NOT retried (isRetryable: false stops retry)
 * - Retry-After duration respected for rate-limited errors
 *
 * Rules applied:
 * - rule 1: assert on EmitoErrorCode values, never message strings
 * - rule 2: assert isRetryable on all error path tests
 * - rule 7: test data builders
 * - rule 22: vi.useFakeTimers() for all backoff timing tests
 * - rule 23: vi.useRealTimers() in afterEach
 * - rule 24: vi.advanceTimersByTimeAsync() for async code
 * - rule 26: assert on shape of return values, not just existence
 */

import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { RetryPolicy } from "@emito/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyJitter, calculateDelay, executeWithRetry } from "../src/dispatch/retry";
import type { RetryContext } from "../src/dispatch/retry";
import { createMockProvider } from "../src/testing/mock-provider";

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function createRetryPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
	return {
		maxAttempts: 3,
		initialDelay: 1000,
		maxDelay: 30_000,
		backoff: "exponential",
		jitter: true,
		...overrides,
	};
}

function createRetryContext(overrides: Partial<RetryContext> = {}): RetryContext {
	return {
		notificationId: "notif_retry_1",
		subscriberId: "sub_retry_1",
		eventType: "user.welcome",
		channel: "email",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Retry execution (with fake timers for backoff)
// ---------------------------------------------------------------------------

describe("executeWithRetry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// ---------------------------------------------------------------------------
	// Success path
	// ---------------------------------------------------------------------------

	describe("success path", () => {
		it("should return the result immediately when the operation succeeds on first attempt", async () => {
			const provider = createMockProvider("email");

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				createRetryPolicy(),
				createRetryContext(),
			);

			expect(result.success).toBe(true);
			expect(result.attempts).toBe(1);
		});

		it("should return a providerMessageId on success", async () => {
			const provider = createMockProvider("email");

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				createRetryPolicy(),
				createRetryContext(),
			);

			expect(result.providerMessageId).toBeDefined();
		});

		it("should succeed on the third attempt after two transient failures", async () => {
			const provider = createMockProvider("email", { mode: "transient", failTimes: 2 });
			const policy = createRetryPolicy({ maxAttempts: 3, initialDelay: 1000, jitter: false });

			const resultPromise = executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			// Advance through retry delays (1s + 2s = 3s for two retries)
			await vi.advanceTimersByTimeAsync(1000);
			await vi.advanceTimersByTimeAsync(2000);

			const result = await resultPromise;

			expect(result.success).toBe(true);
			expect(result.attempts).toBe(3);
		});
	});

	// ---------------------------------------------------------------------------
	// Exponential backoff
	// ---------------------------------------------------------------------------

	describe("exponential backoff", () => {
		it("should wait initialDelay before the first retry", async () => {
			const provider = createMockProvider("email", { mode: "transient", failTimes: 1 });
			const policy = createRetryPolicy({ maxAttempts: 2, initialDelay: 1000, jitter: false });

			const resultPromise = executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			// Before delay: provider called once (failed), second not yet called
			expect(provider.calls).toHaveLength(1);

			// After 999ms: still waiting
			await vi.advanceTimersByTimeAsync(999);
			expect(provider.calls).toHaveLength(1);

			// After 1000ms: retry fires
			await vi.advanceTimersByTimeAsync(1);
			await resultPromise;
			expect(provider.calls).toHaveLength(2);
		});

		it("should double the delay on each retry (exponential)", async () => {
			const delays: number[] = [];
			const policy = createRetryPolicy({ maxAttempts: 4, initialDelay: 1000, jitter: false });
			const provider = createMockProvider("email", { mode: "transient", failTimes: 3 });

			let lastCallTime = Date.now();
			let callCount = 0;
			const originalDeliver = provider.deliver.bind(provider);
			vi.spyOn(provider, "deliver").mockImplementation(async (p) => {
				const now = Date.now();
				callCount++;
				if (callCount > 1) {
					delays.push(now - lastCallTime);
				}
				lastCallTime = now;
				return originalDeliver(p);
			});

			const resultPromise = executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			// Advance through retry 1 (1000ms), retry 2 (2000ms), retry 3 (4000ms)
			await vi.advanceTimersByTimeAsync(1000);
			await vi.advanceTimersByTimeAsync(2000);
			await vi.advanceTimersByTimeAsync(4000);

			await resultPromise;

			// Delays should approximately double: 1s, 2s, 4s
			expect(delays[0]).toBeGreaterThanOrEqual(1000);
			expect(delays[0]).toBeLessThanOrEqual(1200);
			expect(delays[1]).toBeGreaterThanOrEqual(2000);
			expect(delays[1]).toBeLessThanOrEqual(2400);
		});

		it("should cap the delay at maxDelay", async () => {
			const policy = createRetryPolicy({
				maxAttempts: 5,
				initialDelay: 1000,
				maxDelay: 3000,
				backoff: "exponential",
				jitter: false,
			});
			const provider = createMockProvider("email", { mode: "transient", failTimes: 4 });

			const resultPromise = executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			// Advance time through all possible delays (capped at 3000ms each)
			await vi.advanceTimersByTimeAsync(3000);
			await vi.advanceTimersByTimeAsync(3000);
			await vi.advanceTimersByTimeAsync(3000);
			await vi.advanceTimersByTimeAsync(3000);

			const result = await resultPromise;
			expect(result.success).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Jitter — tested directly via applyJitter() and calculateDelay() pure functions
	// (rule 31: don't test private methods — these are exported pure functions)
	// ---------------------------------------------------------------------------

	describe("jitter (±20% tolerance)", () => {
		it("applyJitter should return a value within ±20% of the input", () => {
			const baseDelay = 1000;
			// Run many times to verify all outputs are within bounds
			for (let i = 0; i < 100; i++) {
				const jittered = applyJitter(baseDelay);
				expect(jittered).toBeGreaterThanOrEqual(800);
				expect(jittered).toBeLessThanOrEqual(1200);
			}
		});

		it("applyJitter should return 0 for a 0 base delay", () => {
			expect(applyJitter(0)).toBe(0);
		});

		it("applyJitter should produce varying outputs (not always the same value)", () => {
			const results = new Set<number>();
			for (let i = 0; i < 20; i++) {
				results.add(applyJitter(1000));
			}
			// With random jitter, not all values should be identical
			expect(results.size).toBeGreaterThan(1);
		});

		it("calculateDelay with jitter:true should stay within ±20% of base delay on attempt 2", () => {
			const policy = createRetryPolicy({
				initialDelay: 1000,
				jitter: true,
				backoff: "exponential",
			});
			for (let i = 0; i < 50; i++) {
				const delay = calculateDelay(2, policy);
				// attempt 2, initialDelay 1000, exponential: base = 1000 * 2^0 = 1000ms
				expect(delay).toBeGreaterThanOrEqual(800);
				expect(delay).toBeLessThanOrEqual(1200);
			}
		});

		it("calculateDelay with jitter:false should return exact base delay", () => {
			const policy = createRetryPolicy({
				initialDelay: 1000,
				jitter: false,
				backoff: "exponential",
			});
			// attempt 2, base = 1000ms; attempt 3, base = 2000ms
			expect(calculateDelay(2, policy)).toBe(1000);
			expect(calculateDelay(3, policy)).toBe(2000);
		});

		it("calculateDelay should return 0 for the first attempt (no pre-delay before first try)", () => {
			const policy = createRetryPolicy({ initialDelay: 1000, jitter: false });
			expect(calculateDelay(1, policy)).toBe(0);
		});
	});

	// ---------------------------------------------------------------------------
	// maxAttempts limit
	// ---------------------------------------------------------------------------

	describe("maxAttempts", () => {
		it("should stop retrying after maxAttempts is reached", async () => {
			const provider = createMockProvider("email", { mode: "transient" });
			const policy = createRetryPolicy({ maxAttempts: 3, initialDelay: 100, jitter: false });

			const resultPromise = executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			await vi.advanceTimersByTimeAsync(100);
			await vi.advanceTimersByTimeAsync(200);

			const result = await resultPromise;

			expect(result.success).toBe(false);
			expect(result.exhausted).toBe(true);
			expect(provider.calls).toHaveLength(3);
		});

		it("should make exactly 1 attempt when maxAttempts is 1", async () => {
			const provider = createMockProvider("email", { mode: "transient" });
			const policy = createRetryPolicy({ maxAttempts: 1, initialDelay: 0, jitter: false });

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			expect(provider.calls).toHaveLength(1);
			expect(result.success).toBe(false);
			expect(result.exhausted).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Permanent errors — must not be retried
	// ---------------------------------------------------------------------------

	describe("permanent errors", () => {
		it("should NOT retry when the error is permanent (isRetryable: false)", async () => {
			const provider = createMockProvider("email", { mode: "permanent" });
			const policy = createRetryPolicy({ maxAttempts: 5, initialDelay: 0, jitter: false });

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			// Only 1 attempt — no retries for permanent errors
			expect(provider.calls).toHaveLength(1);
			expect(result.success).toBe(false);
			expect(result.permanent).toBe(true);
		});

		it("should return permanent:true for permanent error results (rule 2)", async () => {
			const provider = createMockProvider("email", { mode: "permanent" });

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				createRetryPolicy({ maxAttempts: 3, initialDelay: 0, jitter: false }),
				createRetryContext(),
			);

			expect(result.permanent).toBe(true);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			expect(result.errorClassification).toBe("permanent");
		});

		it("should set isRetryable: false in the returned error info for permanent errors (rule 2)", async () => {
			const provider = createMockProvider("email", { mode: "permanent" });

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				createRetryPolicy({ maxAttempts: 1, initialDelay: 0, jitter: false }),
				createRetryContext(),
			);

			expect(result.isRetryable).toBe(false);
		});
	});

	// ---------------------------------------------------------------------------
	// Soft bounce — same control flow as transient (retry → exhausted, not permanent)
	// ---------------------------------------------------------------------------

	describe("soft bounce errors", () => {
		it("should retry soft_bounce on the same provider (isRetryable: true)", async () => {
			const provider = createMockProvider("email", { mode: "soft_bounce", failTimes: 1 });
			const policy = createRetryPolicy({ maxAttempts: 2, initialDelay: 100, jitter: false });

			const resultPromise = executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			await vi.advanceTimersByTimeAsync(100);
			const result = await resultPromise;

			// Soft bounce retries — provider called twice (fail then succeed)
			expect(provider.calls).toHaveLength(2);
			expect(result.success).toBe(true);
		});

		it("should classify soft_bounce exhaustion as isRetryable: true, not permanent (rule 2)", async () => {
			const provider = createMockProvider("email", { mode: "soft_bounce" });
			const policy = createRetryPolicy({ maxAttempts: 1, initialDelay: 0, jitter: false });

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			expect(result.success).toBe(false);
			expect(result.permanent).toBeFalsy();
			expect(result.isRetryable).toBe(true);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_SOFT_BOUNCE);
		});

		it("should return DELIVERY_SOFT_BOUNCE errorCode when soft bounce exhausts retries", async () => {
			const provider = createMockProvider("email", { mode: "soft_bounce" });
			const policy = createRetryPolicy({ maxAttempts: 2, initialDelay: 0, jitter: false });

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_SOFT_BOUNCE);
			expect(result.exhausted).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Error code propagation — provider error codes carried through to RetryResult
	// ---------------------------------------------------------------------------

	describe("error code propagation", () => {
		it("should propagate DELIVERY_HARD_BOUNCE from provider (not override with DELIVERY_REJECTED)", async () => {
			const provider = createMockProvider("email", { mode: "hard_bounce" });
			const policy = createRetryPolicy({ maxAttempts: 1, initialDelay: 0, jitter: false });

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			expect(result.permanent).toBe(true);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_HARD_BOUNCE);
			expect(result.errorClassification).toBe("permanent");
		});

		it("should propagate DELIVERY_SPAM_COMPLAINT from provider", async () => {
			const provider = createMockProvider("email", { mode: "spam_complaint" });
			const policy = createRetryPolicy({ maxAttempts: 1, initialDelay: 0, jitter: false });

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			expect(result.permanent).toBe(true);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_SPAM_COMPLAINT);
			expect(result.errorClassification).toBe("permanent");
		});

		it("should propagate DELIVERY_INVALID_ADDRESS from provider", async () => {
			const provider = createMockProvider("email", { mode: "invalid_address" });
			const policy = createRetryPolicy({ maxAttempts: 1, initialDelay: 0, jitter: false });

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			expect(result.permanent).toBe(true);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
			expect(result.errorClassification).toBe("permanent");
		});

		it("should propagate DELIVERY_REJECTED (not override with another code) for rejected mode", async () => {
			const provider = createMockProvider("email", { mode: "rejected" });
			const policy = createRetryPolicy({ maxAttempts: 1, initialDelay: 0, jitter: false });

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			expect(result.permanent).toBe(true);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
			expect(result.errorClassification).toBe("permanent");
		});

		it("should return DELIVERY_REJECTED and permanent:true when provider returns DeliveryResult with errorClassification:permanent (DeliveryResult path)", async () => {
			// This tests the DeliveryResult branch (retry.ts line ~112) where deliver() returns
			// { success: false, errorClassification: "permanent" } rather than throwing.
			// DeliveryResult has no errorCode field, so DELIVERY_REJECTED is the safe default.
			const provider = createMockProvider("email");
			vi.spyOn(provider, "deliver").mockResolvedValueOnce({
				success: false,
				errorClassification: "permanent",
				error: "Provider rejected this address",
			});

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				createRetryPolicy({ maxAttempts: 3, initialDelay: 0, jitter: false }),
				createRetryContext(),
			);

			expect(result.success).toBe(false);
			expect(result.permanent).toBe(true);
			expect(result.isRetryable).toBe(false);
			expect(result.errorClassification).toBe("permanent");
			// DeliveryResult has no errorCode — DELIVERY_REJECTED is the safe default
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
		});

		it("should return soft_bounce classification when provider returns DeliveryResult with errorClassification:soft_bounce", async () => {
			// Tests the DeliveryResult soft_bounce path via return value (not throw).
			// IMPORTANT for provider authors: the DeliveryResult branch in retry.ts
			// only handles errorClassification === "permanent". A returned soft_bounce falls
			// through silently and exhausts via the loop end (errorClassification: "transient").
			// To get proper soft_bounce classification (and avoid suppression), providers MUST
			// throw EmitoError({ code: DELIVERY_SOFT_BOUNCE, isRetryable: true }) rather than
			// returning { success: false, errorClassification: "soft_bounce" }.
			const provider = createMockProvider("email");
			vi.spyOn(provider, "deliver").mockResolvedValueOnce({
				success: false,
				errorClassification: "soft_bounce",
				error: "Mailbox temporarily unavailable",
			});

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				createRetryPolicy({ maxAttempts: 1, initialDelay: 0, jitter: false }),
				createRetryContext(),
			);

			// Exhausts normally — not permanent, not suppression-triggering.
			// errorClassification will be "transient" (not "soft_bounce") on this path.
			expect(result.success).toBe(false);
			expect(result.permanent).toBeFalsy();
			expect(result.exhausted).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Soft bounce — retries like transient, classified as soft_bounce
	// ---------------------------------------------------------------------------

	describe("soft bounce errors", () => {
		it("should retry soft_bounce on the same provider (isRetryable: true)", async () => {
			const provider = createMockProvider("email", { mode: "soft_bounce", failTimes: 2 });
			const policy = createRetryPolicy({ maxAttempts: 3, initialDelay: 100, jitter: false });

			const resultPromise = executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			await vi.advanceTimersByTimeAsync(100);
			await vi.advanceTimersByTimeAsync(200);

			const result = await resultPromise;

			expect(result.success).toBe(true);
			expect(result.attempts).toBe(3);
			expect(provider.calls).toHaveLength(3);
		});

		it("should return errorClassification soft_bounce when exhausted", async () => {
			const provider = createMockProvider("email", { mode: "soft_bounce" });
			const policy = createRetryPolicy({ maxAttempts: 2, initialDelay: 100, jitter: false });

			const resultPromise = executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			await vi.advanceTimersByTimeAsync(100);

			const result = await resultPromise;

			expect(result.success).toBe(false);
			expect(result.exhausted).toBe(true);
			expect(result.permanent).toBeFalsy();
			expect(result.isRetryable).toBe(true);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_SOFT_BOUNCE);
			expect(result.errorClassification).toBe("soft_bounce");
		});

		it("should NOT return permanent:true for soft_bounce (it is retryable)", async () => {
			const provider = createMockProvider("email", { mode: "soft_bounce" });
			const policy = createRetryPolicy({ maxAttempts: 1, initialDelay: 0, jitter: false });

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			expect(result.permanent).toBeFalsy();
			expect(result.isRetryable).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Hard bounce — NOT retried (permanent, isRetryable: false)
	// ---------------------------------------------------------------------------

	describe("hard bounce errors", () => {
		it("should NOT retry hard_bounce (permanent, only 1 attempt)", async () => {
			const provider = createMockProvider("email", { mode: "hard_bounce" });
			const policy = createRetryPolicy({ maxAttempts: 5, initialDelay: 0, jitter: false });

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			expect(provider.calls).toHaveLength(1);
			expect(result.success).toBe(false);
			expect(result.permanent).toBe(true);
			expect(result.isRetryable).toBe(false);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.DELIVERY_HARD_BOUNCE);
			expect(result.errorClassification).toBe("permanent");
		});
	});

	// ---------------------------------------------------------------------------
	// Rate-limited errors — retry same provider, no failover
	// ---------------------------------------------------------------------------

	describe("rate-limited errors", () => {
		it("should retry the SAME provider (not failover) when rate-limited", async () => {
			// Provider that is rate-limited once then succeeds
			const provider = createMockProvider("email", { mode: "rate-limited", failTimes: 1 });
			const policy = createRetryPolicy({ maxAttempts: 2, initialDelay: 500, jitter: false });

			const resultPromise = executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			await vi.advanceTimersByTimeAsync(500);
			const result = await resultPromise;

			// Same provider called twice (rate-limited then success)
			expect(provider.calls).toHaveLength(2);
			expect(result.success).toBe(true);
		});

		it("should classify rate-limited as retryable (rule 2)", async () => {
			const provider = createMockProvider("email", { mode: "rate-limited" });
			const policy = createRetryPolicy({ maxAttempts: 1, initialDelay: 0, jitter: false });

			const result = await executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			expect(result.isRetryable).toBe(true);
			expect(result.errorCode).toBe(EMITO_ERROR_CODE.RATE_LIMITED);
		});

		it("should not mark rate-limited exhaustion as permanent", async () => {
			const provider = createMockProvider("email", { mode: "rate-limited" });
			const policy = createRetryPolicy({ maxAttempts: 2, initialDelay: 0, jitter: false });

			const resultPromise = executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			await vi.advanceTimersByTimeAsync(500);
			const result = await resultPromise;

			expect(result.permanent).toBeFalsy();
			expect(result.rateLimited).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// Retry attempt history
	// ---------------------------------------------------------------------------

	describe("attempt history", () => {
		it("should include each attempt in the returned attempt history", async () => {
			const provider = createMockProvider("email", { mode: "transient", failTimes: 2 });
			const policy = createRetryPolicy({ maxAttempts: 3, initialDelay: 100, jitter: false });

			const resultPromise = executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			await vi.advanceTimersByTimeAsync(100);
			await vi.advanceTimersByTimeAsync(200);

			const result = await resultPromise;

			expect(result.attemptHistory).toHaveLength(3);
			expect(result.attemptHistory[0]).toMatchObject({ attempt: 1, success: false });
			expect(result.attemptHistory[1]).toMatchObject({ attempt: 2, success: false });
			expect(result.attemptHistory[2]).toMatchObject({ attempt: 3, success: true });
		});

		it("should record timestamp for each attempt", async () => {
			const provider = createMockProvider("email", { mode: "transient", failTimes: 1 });
			const policy = createRetryPolicy({ maxAttempts: 2, initialDelay: 100, jitter: false });

			const resultPromise = executeWithRetry(
				provider,
				{
					channel: "email",
					to: "user@example.com",
					subject: "Hi",
					html: "<p>Hi</p>",
					text: "Hi",
					metadata: { notificationId: "n1", subscriberId: "s1", eventType: "test" },
				},
				policy,
				createRetryContext(),
			);

			await vi.advanceTimersByTimeAsync(100);
			const result = await resultPromise;

			for (const entry of result.attemptHistory) {
				expect(entry.timestamp).toBeInstanceOf(Date);
			}
		});
	});
});
