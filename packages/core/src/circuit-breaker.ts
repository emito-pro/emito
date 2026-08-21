/**
 * Redis-backed 3-state circuit breaker for provider failover.
 *
 * State machine:
 *   CLOSED (0-4 failures) --5th failure--> OPEN (skip provider for 30s)
 *                                            |
 *                                       30 seconds
 *                                            |
 *                                       HALF-OPEN (1 probe request)
 *                                       |           |
 *                                    success      failure
 *                                       |           |
 *                                    CLOSED       OPEN
 *
 * Redis key per provider (hash):
 *   emito:cb:{providerName} — hash with fields:
 *     state          — "closed" | "open" | "half-open"
 *     failures       — consecutive failure count (string)
 *     last_transition — timestamp (ms) of last state change (string)
 *
 * Graceful degradation: if Redis is unavailable, all circuits are treated as CLOSED.
 */

import type { Logger } from "./observability/logger";
import type { RedisLike } from "./redis/types";

export type CircuitState = "closed" | "open" | "half-open";

/** Numeric representation for the emito_circuit_breaker_state gauge. */
export const CIRCUIT_STATE_VALUE: Record<CircuitState, number> = {
	closed: 0,
	"half-open": 1,
	open: 2,
};

export interface CircuitBreakerConfig {
	/** Number of consecutive failures before opening the circuit. Default: 5. */
	readonly failureThreshold: number;
	/** Milliseconds to keep the circuit open before transitioning to half-open. Default: 30_000. */
	readonly resetTimeoutMs: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
	failureThreshold: 5,
	resetTimeoutMs: 30_000,
};

/** Minimal metrics interface for the circuit breaker gauge. */
interface CircuitBreakerMetrics {
	circuitBreakerState: { set(labels: Record<string, string>, value: number): void };
}

export interface CircuitBreaker {
	/**
	 * Check if a provider is allowed to receive requests.
	 * - CLOSED: allowed
	 * - OPEN and timeout not expired: not allowed
	 * - OPEN and timeout expired: transitions to HALF-OPEN, allowed (probe)
	 * - HALF-OPEN: allowed (single probe)
	 */
	isAllowed(providerName: string, channel: string): Promise<boolean>;

	/** Record a successful delivery. Transitions to CLOSED if currently HALF-OPEN. */
	recordSuccess(providerName: string, channel: string): Promise<void>;

	/** Record a failed delivery. Increments failure count; transitions to OPEN at threshold. */
	recordFailure(providerName: string, channel: string): Promise<void>;

	/** Get current state for a provider (for diagnostics). */
	getState(providerName: string): Promise<{ state: CircuitState; failures: number }>;
}

function keyPrefix(providerName: string): string {
	return `emito:cb:${providerName}`;
}

export function createCircuitBreaker(deps: {
	readonly redis: RedisLike;
	readonly logger: Logger;
	readonly metrics?: CircuitBreakerMetrics;
	readonly config?: Partial<CircuitBreakerConfig>;
}): CircuitBreaker {
	const { redis, logger, metrics } = deps;
	const config: CircuitBreakerConfig = {
		failureThreshold:
			deps.config?.failureThreshold ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold,
		resetTimeoutMs: deps.config?.resetTimeoutMs ?? DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs,
	};

	function updateMetric(providerName: string, channel: string, state: CircuitState): void {
		metrics?.circuitBreakerState.set(
			{ provider: providerName, channel },
			CIRCUIT_STATE_VALUE[state],
		);
	}

	async function setState(
		providerName: string,
		state: CircuitState,
		failures: number,
	): Promise<void> {
		const key = keyPrefix(providerName);
		const ttlSeconds =
			state === "closed" ? 3600 : Math.ceil((config.resetTimeoutMs * 2) / 1000) + 60;

		await redis
			.multi()
			.hset(key, "state", state)
			.hset(key, "failures", String(failures))
			.hset(key, "last_transition", String(Date.now()))
			.expire(key, ttlSeconds)
			.exec();
	}

	return {
		async isAllowed(providerName: string, channel: string): Promise<boolean> {
			try {
				const key = keyPrefix(providerName);
				const data = await redis.hgetall(key);
				const state = (data.state as CircuitState) || null;

				if (!state || state === "closed") {
					return true;
				}

				if (state === "half-open") {
					// CAS guard: only one probe at a time — the first to grab the lock wins
					const probeKey = `${key}:probe`;
					const acquired = await redis.set(
						probeKey,
						"1",
						"NX",
						"EX",
						Math.ceil(config.resetTimeoutMs / 1000),
					);
					return acquired !== null;
				}

				// state === "open"
				const elapsed = Date.now() - (data.last_transition ? Number(data.last_transition) : 0);

				if (elapsed >= config.resetTimeoutMs) {
					// Timeout expired — transition to half-open, allow one probe
					await setState(providerName, "half-open", 0);
					updateMetric(providerName, channel, "half-open");
					logger.info(
						{ provider: providerName, channel },
						"circuit breaker transitioned to half-open",
					);
					return true;
				}

				// Still in open window — skip provider
				return false;
			} catch (error) {
				// Graceful degradation: treat as closed
				logger.warn(
					{ provider: providerName, error: String(error) },
					"circuit breaker Redis unavailable, allowing request",
				);
				return true;
			}
		},

		async recordSuccess(providerName: string, channel: string): Promise<void> {
			try {
				const key = keyPrefix(providerName);
				const data = await redis.hgetall(key);
				const state = (data.state as CircuitState) || null;

				if (state === "half-open") {
					// Probe succeeded — close the circuit
					await setState(providerName, "closed", 0);
					updateMetric(providerName, channel, "closed");
					logger.info(
						{ provider: providerName, channel },
						"circuit breaker closed after successful probe",
					);
				} else {
					// Reset failure count
					await redis.hset(key, "failures", "0");
					await redis.expire(key, 3600);
					updateMetric(providerName, channel, "closed");
				}
			} catch (error) {
				logger.warn(
					{ provider: providerName, error: String(error) },
					"circuit breaker Redis unavailable on recordSuccess",
				);
			}
		},

		async recordFailure(providerName: string, channel: string): Promise<void> {
			try {
				const key = keyPrefix(providerName);
				const data = await redis.hgetall(key);
				const state = (data.state as CircuitState) || null;

				if (state === "half-open") {
					// Probe failed — reopen
					await setState(providerName, "open", config.failureThreshold);
					updateMetric(providerName, channel, "open");
					logger.info(
						{ provider: providerName, channel },
						"circuit breaker reopened after failed probe",
					);
					return;
				}

				// Increment failure count
				const currentFailures = Number(data.failures) || 0;
				const newFailures = currentFailures + 1;

				if (newFailures >= config.failureThreshold) {
					// Threshold reached — open the circuit
					await setState(providerName, "open", newFailures);
					updateMetric(providerName, channel, "open");
					logger.info(
						{ provider: providerName, channel, failures: newFailures },
						"circuit breaker opened",
					);
				} else {
					await redis.hset(key, "failures", String(newFailures));
					await redis.expire(key, 3600);
					updateMetric(providerName, channel, "closed");
				}
			} catch (error) {
				logger.warn(
					{ provider: providerName, error: String(error) },
					"circuit breaker Redis unavailable on recordFailure",
				);
			}
		},

		async getState(providerName: string): Promise<{ state: CircuitState; failures: number }> {
			try {
				const key = keyPrefix(providerName);
				const data = await redis.hgetall(key);
				const state = (data.state as CircuitState) || "closed";
				const failures = Number(data.failures) || 0;
				return { state, failures };
			} catch {
				return { state: "closed", failures: 0 };
			}
		},
	};
}
