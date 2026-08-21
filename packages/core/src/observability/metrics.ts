import { Counter, Gauge, Histogram, Registry } from "prom-client";

export interface MetricsConfig {
	enabled: boolean;
	prefix?: string;
	registry?: Registry;
}

export interface EmitoMetrics {
	prefix: string;
	notificationsSentTotal: Counter;
	deliveryDurationMs: Histogram;
	providerErrorsTotal: Counter;
	circuitBreakerState: Gauge;
	rateLimitHitsTotal: Counter;
	queueDepth: Gauge;
	bounceTotal: Counter;
	engagementTotal: Counter;
}

function createNoopCounter(): Counter {
	return { inc: () => {} } as unknown as Counter;
}

function createNoopHistogram(): Histogram {
	return { observe: () => {} } as unknown as Histogram;
}

function createNoopGauge(): Gauge {
	return { set: () => {}, inc: () => {}, dec: () => {} } as unknown as Gauge;
}

/**
 * Creates the 8 Prometheus metrics defined in the logging standard.
 * When metrics are disabled, returns noop implementations that do nothing.
 */
export function createMetrics(config: MetricsConfig): EmitoMetrics {
	const prefix = config.prefix ?? "emito";

	if (!config.enabled) {
		return {
			prefix,
			notificationsSentTotal: createNoopCounter(),
			deliveryDurationMs: createNoopHistogram(),
			providerErrorsTotal: createNoopCounter(),
			circuitBreakerState: createNoopGauge(),
			rateLimitHitsTotal: createNoopCounter(),
			queueDepth: createNoopGauge(),
			bounceTotal: createNoopCounter(),
			engagementTotal: createNoopCounter(),
		};
	}

	const registry = config.registry ?? new Registry();
	const registries = [registry];

	const notificationsSentTotal = new Counter({
		name: `${prefix}_notifications_sent_total`,
		help: "Total notifications sent, partitioned by outcome",
		labelNames: ["channel", "provider", "status"] as const,
		registers: registries,
	});

	const deliveryDurationMs = new Histogram({
		name: `${prefix}_delivery_duration_ms`,
		help: "End-to-end delivery duration in milliseconds",
		labelNames: ["channel", "provider"] as const,
		buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
		registers: registries,
	});

	const providerErrorsTotal = new Counter({
		name: `${prefix}_provider_errors_total`,
		help: "Provider errors, partitioned by error type",
		labelNames: ["channel", "provider", "error_code"] as const,
		registers: registries,
	});

	const circuitBreakerState = new Gauge({
		name: `${prefix}_circuit_breaker_state`,
		help: "Current circuit breaker state (0=closed, 1=half-open, 2=open)",
		labelNames: ["channel", "provider"] as const,
		registers: registries,
	});

	const rateLimitHitsTotal = new Counter({
		name: `${prefix}_rate_limit_hits_total`,
		help: "Rate limit rejections from providers",
		labelNames: ["channel", "provider"] as const,
		registers: registries,
	});

	const queueDepth = new Gauge({
		name: `${prefix}_queue_depth`,
		help: "Current number of notifications waiting in queue",
		labelNames: ["channel"] as const,
		registers: registries,
	});

	const bounceTotal = new Counter({
		name: `${prefix}_bounce_total`,
		help: "Bounce events (hard, soft, complaint)",
		labelNames: ["channel", "provider", "bounce_type"] as const,
		registers: registries,
	});

	const engagementTotal = new Counter({
		name: `${prefix}_engagement_total`,
		help: "Engagement events (open, click, dismiss)",
		labelNames: ["channel", "engagement_type"] as const,
		registers: registries,
	});

	return {
		prefix,
		notificationsSentTotal,
		deliveryDurationMs,
		providerErrorsTotal,
		circuitBreakerState,
		rateLimitHitsTotal,
		queueDepth,
		bounceTotal,
		engagementTotal,
	};
}
