import type { ProviderPlugin } from "@emito/types";
import type { DigestEngine } from "./digest/engine";
import type { Logger } from "./observability/logger";
import type { RedisLike } from "./redis/types";

const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5000;

export interface HealthCheckResult {
	healthy: boolean;
	providers: ProviderHealthResult[];
	redis?: { healthy: boolean };
}

export interface ProviderHealthResult {
	name: string;
	channel: string;
	healthy: boolean;
}

export interface LifecycleDeps {
	providers: ProviderPlugin[];
	logger: Logger;
	redis?: RedisLike;
	digestEngine?: DigestEngine;
	healthCheckTimeoutMs?: number;
}

/**
 * Races a promise against a timeout. Rejects with a timeout error if the timer fires first.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`Health check timed out after ${ms}ms`)), ms);
		promise.then(
			(val) => {
				clearTimeout(timer);
				resolve(val);
			},
			(err) => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}

/**
 * Initializes the Emito instance — validates that all providers are reachable.
 */
export async function start(deps: LifecycleDeps): Promise<void> {
	const { providers, logger, redis } = deps;
	const timeoutMs = deps.healthCheckTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
	logger.info({ providerCount: providers.length }, "starting emito");

	if (redis) {
		try {
			await redis.ping();
			logger.info("redis connected");
		} catch (error) {
			logger.warn({ error: String(error) }, "redis ping failed at startup");
		}
	}

	const results = await Promise.allSettled(
		providers.map((provider) =>
			withTimeout(provider.healthCheck(), timeoutMs).then((healthy) => ({ provider, healthy })),
		),
	);

	for (let i = 0; i < results.length; i++) {
		const result = results[i];
		const provider = providers[i];
		if (!result || !provider) continue;
		if (result.status === "fulfilled") {
			if (!result.value.healthy) {
				logger.warn(
					{ provider: provider.name, channel: provider.channel },
					"provider unhealthy at startup",
				);
			}
		} else {
			logger.warn(
				{ provider: provider.name, channel: provider.channel, error: String(result.reason) },
				"provider health check failed at startup",
			);
		}
	}

	if (deps.digestEngine) {
		await deps.digestEngine.start();
	}

	logger.info("emito started");
}

/**
 * Graceful shutdown — flushes any pending operations.
 */
export async function stop(deps: LifecycleDeps): Promise<void> {
	const { logger, redis } = deps;
	logger.info("stopping emito");

	if (deps.digestEngine) {
		await deps.digestEngine.stop();
	}

	if (redis) {
		try {
			await redis.quit();
			logger.info("redis disconnected");
		} catch (error) {
			logger.warn({ error: String(error) }, "redis quit failed during shutdown");
		}
	}

	logger.info("emito stopped");
}

/**
 * Aggregates health check results from all registered providers.
 */
export async function healthCheck(deps: LifecycleDeps): Promise<HealthCheckResult> {
	const { providers, logger, redis } = deps;
	const timeoutMs = deps.healthCheckTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
	const providerResults: ProviderHealthResult[] = [];

	let redisHealthy: boolean | undefined;
	if (redis) {
		try {
			await redis.ping();
			redisHealthy = true;
		} catch (error) {
			logger.warn({ error: String(error) }, "redis health check failed");
			redisHealthy = false;
		}
	}

	const settled = await Promise.allSettled(
		providers.map((provider) =>
			withTimeout(provider.healthCheck(), timeoutMs).then((healthy) => ({ provider, healthy })),
		),
	);

	for (let i = 0; i < settled.length; i++) {
		const result = settled[i];
		const provider = providers[i];
		if (!result || !provider) continue;
		if (result.status === "fulfilled") {
			providerResults.push({
				name: provider.name,
				channel: provider.channel,
				healthy: result.value.healthy,
			});
		} else {
			logger.warn(
				{ provider: provider.name, channel: provider.channel, error: String(result.reason) },
				"provider health check error",
			);
			providerResults.push({ name: provider.name, channel: provider.channel, healthy: false });
		}
	}

	const providersHealthy = providerResults.length === 0 || providerResults.every((r) => r.healthy);
	const allHealthy = providersHealthy && (redisHealthy === undefined || redisHealthy);

	const healthResult: HealthCheckResult = { healthy: allHealthy, providers: providerResults };
	if (redisHealthy !== undefined) {
		healthResult.redis = { healthy: redisHealthy };
	}
	return healthResult;
}
