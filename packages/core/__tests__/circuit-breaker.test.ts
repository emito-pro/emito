/**
 * Tests for the 3-state circuit breaker (Task 3).
 *
 * Success criteria:
 * - CLOSED → OPEN after 5 consecutive failures
 * - OPEN skips provider for 30 seconds
 * - HALF-OPEN allows exactly 1 probe request
 * - Probe success → CLOSED, probe failure → OPEN
 * - State shared across instances via Redis
 * - Graceful degradation treats as CLOSED when Redis unavailable
 * - emito_circuit_breaker_state gauge reflects current state
 *   (CIRCUIT_STATE_VALUE: closed=0, half-open=1, open=2)
 * - Dispatcher correctly skips providers with open circuits
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CIRCUIT_STATE_VALUE,
	type CircuitBreaker,
	type CircuitState,
	createCircuitBreaker,
} from "../src/circuit-breaker";
import { type MockRedis, createMockRedis } from "./helpers/mock-redis";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function createMockLogger() {
	return {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		trace: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
		level: "silent" as const,
	};
}

function createMockMetrics() {
	return {
		circuitBreakerState: { set: vi.fn() },
	};
}

const PROVIDER = "sendgrid";
const CHANNEL = "email";
const CB_KEY_PREFIX = "emito:cb";

// Helper to get the CircuitState string from getState
async function getStateStr(cb: CircuitBreaker, provider: string): Promise<CircuitState> {
	const result = await cb.getState(provider);
	return result.state;
}

// ---------------------------------------------------------------------------
// State machine — CLOSED transitions
// ---------------------------------------------------------------------------

describe("createCircuitBreaker", () => {
	let redis: MockRedis;
	let logger: ReturnType<typeof createMockLogger>;
	let cb: CircuitBreaker;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		redis = createMockRedis();
		logger = createMockLogger();
		cb = createCircuitBreaker({ redis, logger });
	});

	afterEach(() => {
		vi.useRealTimers();
		redis.clear();
	});

	// -----------------------------------------------------------------------
	// CLOSED state (initial / happy path)
	// -----------------------------------------------------------------------

	describe("CLOSED state", () => {
		it("starts CLOSED and allows requests", async () => {
			const allowed = await cb.isAllowed(PROVIDER, CHANNEL);
			expect(allowed).toBe(true);
		});

		it("remains CLOSED after 4 consecutive failures", async () => {
			for (let i = 0; i < 4; i++) {
				await cb.recordFailure(PROVIDER, CHANNEL);
			}

			const allowed = await cb.isAllowed(PROVIDER, CHANNEL);
			expect(allowed).toBe(true);
		});

		it("failure count resets to 0 after recordSuccess", async () => {
			for (let i = 0; i < 4; i++) {
				await cb.recordFailure(PROVIDER, CHANNEL);
			}

			await cb.recordSuccess(PROVIDER, CHANNEL);

			// Should still be CLOSED and allow request
			const allowed = await cb.isAllowed(PROVIDER, CHANNEL);
			expect(allowed).toBe(true);

			// One more failure should not open (counter reset, needs 5 to open)
			await cb.recordFailure(PROVIDER, CHANNEL);
			const stillAllowed = await cb.isAllowed(PROVIDER, CHANNEL);
			expect(stillAllowed).toBe(true);
		});

		it("getState returns 'closed' initially", async () => {
			expect(await getStateStr(cb, PROVIDER)).toBe("closed");
		});

		it("getState returns 'closed' after fewer than 5 failures", async () => {
			for (let i = 0; i < 3; i++) {
				await cb.recordFailure(PROVIDER, CHANNEL);
			}

			expect(await getStateStr(cb, PROVIDER)).toBe("closed");
		});

		it("getState includes failure count", async () => {
			await cb.recordFailure(PROVIDER, CHANNEL);
			await cb.recordFailure(PROVIDER, CHANNEL);

			const result = await cb.getState(PROVIDER);
			expect(result).toMatchObject({ state: "closed", failures: 2 });
		});
	});

	// -----------------------------------------------------------------------
	// CLOSED → OPEN on 5th failure
	// -----------------------------------------------------------------------

	describe("CLOSED → OPEN transition", () => {
		it("opens on the 5th consecutive failure", async () => {
			for (let i = 0; i < 5; i++) {
				await cb.recordFailure(PROVIDER, CHANNEL);
			}

			const allowed = await cb.isAllowed(PROVIDER, CHANNEL);
			expect(allowed).toBe(false);
		});

		it("getState returns 'open' after 5 failures", async () => {
			for (let i = 0; i < 5; i++) {
				await cb.recordFailure(PROVIDER, CHANNEL);
			}

			expect(await getStateStr(cb, PROVIDER)).toBe("open");
		});

		it("does not open before the 5th failure (boundary: exactly 5)", async () => {
			for (let i = 0; i < 4; i++) {
				await cb.recordFailure(PROVIDER, CHANNEL);
			}
			expect(await cb.isAllowed(PROVIDER, CHANNEL)).toBe(true);

			await cb.recordFailure(PROVIDER, CHANNEL);
			expect(await cb.isAllowed(PROVIDER, CHANNEL)).toBe(false);
		});

		it("circuits are independent per provider", async () => {
			// Open sendgrid circuit
			for (let i = 0; i < 5; i++) {
				await cb.recordFailure("sendgrid", CHANNEL);
			}

			// mailgun must still be CLOSED
			const mailgunAllowed = await cb.isAllowed("mailgun", CHANNEL);
			expect(mailgunAllowed).toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// OPEN state (skip for 30 seconds)
	// -----------------------------------------------------------------------

	describe("OPEN state", () => {
		beforeEach(async () => {
			// Bring circuit to OPEN
			for (let i = 0; i < 5; i++) {
				await cb.recordFailure(PROVIDER, CHANNEL);
			}
		});

		it("blocks requests while OPEN", async () => {
			expect(await cb.isAllowed(PROVIDER, CHANNEL)).toBe(false);
		});

		it("remains OPEN before the 30-second timeout", async () => {
			vi.advanceTimersByTime(29_000);
			expect(await cb.isAllowed(PROVIDER, CHANNEL)).toBe(false);
		});

		it("transitions to HALF-OPEN after 30 seconds", async () => {
			vi.advanceTimersByTime(30_001);

			// isAllowed triggers the transition detection
			await cb.isAllowed(PROVIDER, CHANNEL);
			expect(await getStateStr(cb, PROVIDER)).toBe("half-open");
		});

		it("allows the probe request after 30 seconds (HALF-OPEN)", async () => {
			vi.advanceTimersByTime(30_001);

			// Probe allowed — transitions to half-open and returns true
			const firstProbe = await cb.isAllowed(PROVIDER, CHANNEL);
			expect(firstProbe).toBe(true);
		});

		it("state is half-open while awaiting probe result", async () => {
			vi.advanceTimersByTime(30_001);

			// After isAllowed transitions to half-open, state reflects that
			await cb.isAllowed(PROVIDER, CHANNEL);
			expect(await getStateStr(cb, PROVIDER)).toBe("half-open");
		});
	});

	// -----------------------------------------------------------------------
	// HALF-OPEN → CLOSED (probe success)
	// -----------------------------------------------------------------------

	describe("HALF-OPEN → CLOSED on probe success", () => {
		beforeEach(async () => {
			// Bring to OPEN then advance to HALF-OPEN
			for (let i = 0; i < 5; i++) {
				await cb.recordFailure(PROVIDER, CHANNEL);
			}
			vi.advanceTimersByTime(30_001);
			await cb.isAllowed(PROVIDER, CHANNEL); // consume the probe slot
		});

		it("transitions to CLOSED after probe success", async () => {
			await cb.recordSuccess(PROVIDER, CHANNEL);

			expect(await getStateStr(cb, PROVIDER)).toBe("closed");
		});

		it("allows requests again after HALF-OPEN probe success", async () => {
			await cb.recordSuccess(PROVIDER, CHANNEL);

			const allowed = await cb.isAllowed(PROVIDER, CHANNEL);
			expect(allowed).toBe(true);
		});

		it("resets failure count to 0 after probe success", async () => {
			await cb.recordSuccess(PROVIDER, CHANNEL);

			const result = await cb.getState(PROVIDER);
			expect(result.failures).toBe(0);
		});

		it("needs 5 fresh failures to reopen after successful probe", async () => {
			await cb.recordSuccess(PROVIDER, CHANNEL);

			// Should need 5 fresh failures to open again
			for (let i = 0; i < 4; i++) {
				await cb.recordFailure(PROVIDER, CHANNEL);
			}
			expect(await cb.isAllowed(PROVIDER, CHANNEL)).toBe(true);

			await cb.recordFailure(PROVIDER, CHANNEL);
			expect(await cb.isAllowed(PROVIDER, CHANNEL)).toBe(false);
		});
	});

	// -----------------------------------------------------------------------
	// HALF-OPEN → OPEN (probe failure)
	// -----------------------------------------------------------------------

	describe("HALF-OPEN → OPEN on probe failure", () => {
		beforeEach(async () => {
			// Bring to OPEN then advance to HALF-OPEN
			for (let i = 0; i < 5; i++) {
				await cb.recordFailure(PROVIDER, CHANNEL);
			}
			vi.advanceTimersByTime(30_001);
			await cb.isAllowed(PROVIDER, CHANNEL); // consume probe slot
		});

		it("transitions back to OPEN after probe failure", async () => {
			await cb.recordFailure(PROVIDER, CHANNEL);

			expect(await getStateStr(cb, PROVIDER)).toBe("open");
		});

		it("blocks subsequent requests after probe failure", async () => {
			await cb.recordFailure(PROVIDER, CHANNEL);

			const blocked = await cb.isAllowed(PROVIDER, CHANNEL);
			expect(blocked).toBe(false);
		});

		it("restarts the 30-second open window after probe failure", async () => {
			await cb.recordFailure(PROVIDER, CHANNEL);

			// Advance less than 30 seconds — must still be OPEN
			vi.advanceTimersByTime(29_000);
			expect(await cb.isAllowed(PROVIDER, CHANNEL)).toBe(false);

			// Advance past 30 seconds — should transition to HALF-OPEN again
			vi.advanceTimersByTime(1_001);
			await cb.isAllowed(PROVIDER, CHANNEL); // trigger transition
			expect(await getStateStr(cb, PROVIDER)).toBe("half-open");
		});
	});

	// -----------------------------------------------------------------------
	// Redis key pattern
	// -----------------------------------------------------------------------

	describe("Redis key pattern", () => {
		it("stores state in emito:cb:{providerName} hash", async () => {
			for (let i = 0; i < 5; i++) {
				await cb.recordFailure(PROVIDER, CHANNEL);
			}

			const data = await redis.hgetall(`${CB_KEY_PREFIX}:${PROVIDER}`);
			expect(data.state).toBe("open");
		});

		it("stores failures in emito:cb:{providerName} hash", async () => {
			await cb.recordFailure(PROVIDER, CHANNEL);
			await cb.recordFailure(PROVIDER, CHANNEL);

			const data = await redis.hgetall(`${CB_KEY_PREFIX}:${PROVIDER}`);
			expect(Number(data.failures)).toBe(2);
		});

		it("stores last_transition in emito:cb:{providerName} hash when opening", async () => {
			for (let i = 0; i < 5; i++) {
				await cb.recordFailure(PROVIDER, CHANNEL);
			}

			const data = await redis.hgetall(`${CB_KEY_PREFIX}:${PROVIDER}`);
			expect(data.last_transition).toBeDefined();
			expect(Number(data.last_transition)).toBeGreaterThan(0);
		});

		it("uses separate hash keys per provider", async () => {
			for (let i = 0; i < 5; i++) {
				await cb.recordFailure("sendgrid", CHANNEL);
			}

			const sendgridData = await redis.hgetall(`${CB_KEY_PREFIX}:sendgrid`);
			const mailgunData = await redis.hgetall(`${CB_KEY_PREFIX}:mailgun`);

			expect(sendgridData.state).toBe("open");
			expect(!mailgunData.state || mailgunData.state === "closed").toBe(true);
		});
	});

	// -----------------------------------------------------------------------
	// State shared across instances via Redis
	// -----------------------------------------------------------------------

	describe("state shared across instances via Redis", () => {
		it("second instance sees OPEN state written by first instance", async () => {
			const cb1 = createCircuitBreaker({ redis, logger });
			for (let i = 0; i < 5; i++) {
				await cb1.recordFailure(PROVIDER, CHANNEL);
			}

			const cb2 = createCircuitBreaker({ redis, logger: createMockLogger() });
			const allowed = await cb2.isAllowed(PROVIDER, CHANNEL);
			expect(allowed).toBe(false);
		});

		it("second instance sees CLOSED after first instance records success from HALF-OPEN", async () => {
			const cb1 = createCircuitBreaker({ redis, logger });
			for (let i = 0; i < 5; i++) {
				await cb1.recordFailure(PROVIDER, CHANNEL);
			}
			vi.advanceTimersByTime(30_001);
			await cb1.isAllowed(PROVIDER, CHANNEL); // probe slot
			await cb1.recordSuccess(PROVIDER, CHANNEL);

			const cb2 = createCircuitBreaker({ redis, logger: createMockLogger() });
			expect(await cb2.isAllowed(PROVIDER, CHANNEL)).toBe(true);
		});
	});
});

// ---------------------------------------------------------------------------
// CIRCUIT_STATE_VALUE constant
// ---------------------------------------------------------------------------

describe("CIRCUIT_STATE_VALUE", () => {
	it("closed maps to 0", () => {
		expect(CIRCUIT_STATE_VALUE.closed).toBe(0);
	});

	it("half-open maps to 1", () => {
		expect(CIRCUIT_STATE_VALUE["half-open"]).toBe(1);
	});

	it("open maps to 2", () => {
		expect(CIRCUIT_STATE_VALUE.open).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Prometheus metric: emito_circuit_breaker_state
// ---------------------------------------------------------------------------

describe("emito_circuit_breaker_state metric", () => {
	let redis: MockRedis;
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		redis = createMockRedis();
		logger = createMockLogger();
	});

	afterEach(() => {
		vi.useRealTimers();
		redis.clear();
	});

	it("sets gauge to 2 (OPEN) when circuit opens on 5th failure", async () => {
		const metrics = createMockMetrics();
		const cb = createCircuitBreaker({ redis, logger, metrics });

		for (let i = 0; i < 5; i++) {
			await cb.recordFailure(PROVIDER, CHANNEL);
		}

		expect(metrics.circuitBreakerState.set).toHaveBeenLastCalledWith(
			expect.objectContaining({ provider: PROVIDER }),
			CIRCUIT_STATE_VALUE.open,
		);
	});

	it("sets gauge to 1 (HALF-OPEN) when transitioning from OPEN", async () => {
		const metrics = createMockMetrics();
		const cb = createCircuitBreaker({ redis, logger, metrics });

		for (let i = 0; i < 5; i++) {
			await cb.recordFailure(PROVIDER, CHANNEL);
		}
		vi.advanceTimersByTime(30_001);

		// isAllowed triggers the HALF-OPEN transition
		await cb.isAllowed(PROVIDER, CHANNEL);

		expect(metrics.circuitBreakerState.set).toHaveBeenLastCalledWith(
			expect.objectContaining({ provider: PROVIDER }),
			CIRCUIT_STATE_VALUE["half-open"],
		);
	});

	it("sets gauge to 0 (CLOSED) on recordSuccess from HALF-OPEN", async () => {
		const metrics = createMockMetrics();
		const cb = createCircuitBreaker({ redis, logger, metrics });

		for (let i = 0; i < 5; i++) {
			await cb.recordFailure(PROVIDER, CHANNEL);
		}
		vi.advanceTimersByTime(30_001);
		await cb.isAllowed(PROVIDER, CHANNEL);
		await cb.recordSuccess(PROVIDER, CHANNEL);

		expect(metrics.circuitBreakerState.set).toHaveBeenLastCalledWith(
			expect.objectContaining({ provider: PROVIDER }),
			CIRCUIT_STATE_VALUE.closed,
		);
	});

	it("sets gauge to 2 (OPEN) on probe failure from HALF-OPEN", async () => {
		const metrics = createMockMetrics();
		const cb = createCircuitBreaker({ redis, logger, metrics });

		for (let i = 0; i < 5; i++) {
			await cb.recordFailure(PROVIDER, CHANNEL);
		}
		vi.advanceTimersByTime(30_001);
		await cb.isAllowed(PROVIDER, CHANNEL);
		await cb.recordFailure(PROVIDER, CHANNEL);

		expect(metrics.circuitBreakerState.set).toHaveBeenLastCalledWith(
			expect.objectContaining({ provider: PROVIDER }),
			CIRCUIT_STATE_VALUE.open,
		);
	});

	it("works without metrics configured (no throw)", async () => {
		const cb = createCircuitBreaker({ redis, logger }); // no metrics

		for (let i = 0; i < 5; i++) {
			await cb.recordFailure(PROVIDER, CHANNEL);
		}

		await expect(cb.isAllowed(PROVIDER, CHANNEL)).resolves.toBe(false);
	});

	it("includes channel label in metric call", async () => {
		const metrics = createMockMetrics();
		const cb = createCircuitBreaker({ redis, logger, metrics });

		for (let i = 0; i < 5; i++) {
			await cb.recordFailure(PROVIDER, "sms");
		}

		expect(metrics.circuitBreakerState.set).toHaveBeenLastCalledWith(
			expect.objectContaining({ provider: PROVIDER, channel: "sms" }),
			CIRCUIT_STATE_VALUE.open,
		);
	});
});

// ---------------------------------------------------------------------------
// Graceful degradation — Redis unavailable
// ---------------------------------------------------------------------------

describe("graceful degradation when Redis is unavailable", () => {
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		logger = createMockLogger();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function makeFailingRedis(): MockRedis {
		const r = createMockRedis();
		vi.spyOn(r, "hgetall").mockRejectedValue(new Error("ECONNREFUSED"));
		vi.spyOn(r, "hset").mockRejectedValue(new Error("ECONNREFUSED"));
		vi.spyOn(r, "del").mockRejectedValue(new Error("ECONNREFUSED"));
		return r;
	}

	it("treats circuit as CLOSED (allows all) when Redis get() throws", async () => {
		const redis = makeFailingRedis();
		const cb = createCircuitBreaker({ redis, logger });

		const allowed = await cb.isAllowed(PROVIDER, CHANNEL);
		expect(allowed).toBe(true);
	});

	it("does not throw when recordFailure encounters Redis error", async () => {
		const redis = makeFailingRedis();
		const cb = createCircuitBreaker({ redis, logger });

		await expect(cb.recordFailure(PROVIDER, CHANNEL)).resolves.not.toThrow();
	});

	it("does not throw when recordSuccess encounters Redis error", async () => {
		const redis = makeFailingRedis();
		const cb = createCircuitBreaker({ redis, logger });

		await expect(cb.recordSuccess(PROVIDER, CHANNEL)).resolves.not.toThrow();
	});

	it("logs a warn when Redis is unavailable during isAllowed", async () => {
		const redis = makeFailingRedis();
		const cb = createCircuitBreaker({ redis, logger });

		await cb.isAllowed(PROVIDER, CHANNEL);

		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ error: expect.any(String) }),
			expect.any(String),
		);
	});

	it("does not increment metric when Redis is unavailable", async () => {
		const metrics = createMockMetrics();
		const redis = makeFailingRedis();
		const cb = createCircuitBreaker({ redis, logger, metrics });

		await cb.isAllowed(PROVIDER, CHANNEL);
		expect(metrics.circuitBreakerState.set).not.toHaveBeenCalled();
	});

	it("getState returns closed/0 when Redis is unavailable", async () => {
		const redis = makeFailingRedis();
		const cb = createCircuitBreaker({ redis, logger });

		const result = await cb.getState(PROVIDER);
		expect(result).toMatchObject({ state: "closed", failures: 0 });
	});
});

// ---------------------------------------------------------------------------
// Dispatcher integration — isAllowed gate
// ---------------------------------------------------------------------------

describe("dispatcher gate: isAllowed correctly signals open/closed circuits", () => {
	let redis: MockRedis;
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		redis = createMockRedis();
		logger = createMockLogger();
	});

	afterEach(() => {
		vi.useRealTimers();
		redis.clear();
	});

	it("isAllowed returns false for a provider with an open circuit", async () => {
		const cb = createCircuitBreaker({ redis, logger });

		for (let i = 0; i < 5; i++) {
			await cb.recordFailure("twilio", "sms");
		}

		expect(await cb.isAllowed("twilio", "sms")).toBe(false);
	});

	it("isAllowed returns true for a different provider when one is open", async () => {
		const cb = createCircuitBreaker({ redis, logger });

		for (let i = 0; i < 5; i++) {
			await cb.recordFailure("twilio", "sms");
		}

		// vonage circuit is independent
		expect(await cb.isAllowed("vonage", "sms")).toBe(true);
	});

	it("isAllowed returns true immediately after circuit closes", async () => {
		const cb = createCircuitBreaker({ redis, logger });

		for (let i = 0; i < 5; i++) {
			await cb.recordFailure(PROVIDER, CHANNEL);
		}

		// Advance to HALF-OPEN and succeed
		vi.advanceTimersByTime(30_001);
		await cb.isAllowed(PROVIDER, CHANNEL); // probe
		await cb.recordSuccess(PROVIDER, CHANNEL);

		// Normal requests now allowed
		expect(await cb.isAllowed(PROVIDER, CHANNEL)).toBe(true);
		expect(await cb.isAllowed(PROVIDER, CHANNEL)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Boundary conditions
// ---------------------------------------------------------------------------

describe("boundary conditions", () => {
	let redis: MockRedis;
	let logger: ReturnType<typeof createMockLogger>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
		redis = createMockRedis();
		logger = createMockLogger();
	});

	afterEach(() => {
		vi.useRealTimers();
		redis.clear();
	});

	it("many failures beyond 5 do not cause errors", async () => {
		const cb = createCircuitBreaker({ redis, logger });

		for (let i = 0; i < 20; i++) {
			await cb.recordFailure(PROVIDER, CHANNEL);
		}

		expect(await cb.isAllowed(PROVIDER, CHANNEL)).toBe(false);
		expect(await getStateStr(cb, PROVIDER)).toBe("open");
	});

	it("recording success when already CLOSED does not throw", async () => {
		const cb = createCircuitBreaker({ redis, logger });

		await expect(cb.recordSuccess(PROVIDER, CHANNEL)).resolves.not.toThrow();
		expect(await cb.isAllowed(PROVIDER, CHANNEL)).toBe(true);
	});

	it("handles custom config: 3 failure threshold", async () => {
		const cb = createCircuitBreaker({
			redis,
			logger,
			config: { failureThreshold: 3, resetTimeoutMs: 30_000 },
		});

		await cb.recordFailure(PROVIDER, CHANNEL);
		await cb.recordFailure(PROVIDER, CHANNEL);
		expect(await cb.isAllowed(PROVIDER, CHANNEL)).toBe(true);

		await cb.recordFailure(PROVIDER, CHANNEL);
		expect(await cb.isAllowed(PROVIDER, CHANNEL)).toBe(false);
	});

	it("handles custom config: shorter reset timeout (5s)", async () => {
		const cb = createCircuitBreaker({
			redis,
			logger,
			config: { failureThreshold: 5, resetTimeoutMs: 5_000 },
		});

		for (let i = 0; i < 5; i++) {
			await cb.recordFailure(PROVIDER, CHANNEL);
		}

		vi.advanceTimersByTime(4_999);
		expect(await cb.isAllowed(PROVIDER, CHANNEL)).toBe(false);

		vi.advanceTimersByTime(2);
		await cb.isAllowed(PROVIDER, CHANNEL); // trigger transition
		expect(await getStateStr(cb, PROVIDER)).toBe("half-open");
	});

	it("zero failures: getState returns failures=0", async () => {
		const cb = createCircuitBreaker({ redis, logger });

		const result = await cb.getState(PROVIDER);
		expect(result).toMatchObject({ state: "closed", failures: 0 });
	});
});
