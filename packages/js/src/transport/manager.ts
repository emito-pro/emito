import type {
	CapabilitiesResponse,
	TransportAdapter,
	TransportConfig,
	TransportType,
	WsAuthMode,
} from "../types.js";
import { PollingAdapter } from "./polling.js";
import { SSEAdapter } from "./sse.js";
import { WebSocketAdapter } from "./websocket.js";

/** Preferred transport order — best first */
const PREFERENCE_ORDER: TransportType[] = ["ws", "sse", "polling"];

/** Options for TransportManager beyond the base TransportConfig */
export interface TransportManagerOptions extends TransportConfig {
	wsAuth?: WsAuthMode;
	wsEndpoint?: string;
	/** Poll interval in ms when the polling transport is selected (default: 10000). */
	pollIntervalMs?: number;
}

/**
 * Transport manager — probes `/capabilities` and selects the best available transport.
 * Falls back through the chain on connection failure.
 */
export class TransportManager {
	private readonly endpoint: string;
	private readonly token: string | undefined;
	private readonly getToken: (() => Promise<string>) | undefined;
	private readonly subscriberId: string;
	private readonly wsAuth: WsAuthMode | undefined;
	private readonly wsEndpoint: string | undefined;
	private readonly pollIntervalMs: number | undefined;
	private cachedCapabilities: string[] | null = null;

	constructor(config: TransportManagerOptions) {
		this.endpoint = config.endpoint;
		this.token = config.token;
		this.getToken = config.getToken;
		this.subscriberId = config.subscriberId;
		this.wsAuth = config.wsAuth;
		this.wsEndpoint = config.wsEndpoint;
		this.pollIntervalMs = config.pollIntervalMs;
	}

	/**
	 * Create a specific transport adapter by type.
	 */
	createAdapter(type: TransportType, lastEventId?: string): TransportAdapter {
		const config: TransportConfig = {
			endpoint: this.endpoint,
			subscriberId: this.subscriberId,
			token: this.token,
			getToken: this.getToken,
			lastEventId,
		};

		switch (type) {
			case "ws":
				return new WebSocketAdapter({
					...config,
					wsAuth: this.wsAuth,
					wsEndpoint: this.wsEndpoint,
				});
			case "sse":
				return new SSEAdapter(config);
			case "polling":
				return new PollingAdapter({ ...config, intervalMs: this.pollIntervalMs });
		}
	}

	/**
	 * Probe the capabilities endpoint and connect using the best available transport.
	 * Tries transports in preference order (ws > sse > polling), falling back on failure.
	 */
	async selectAndConnect(lastEventId?: string): Promise<TransportAdapter> {
		const available = await this.probeCapabilities();
		const ordered = PREFERENCE_ORDER.filter((t) => available.includes(t));

		if (ordered.length === 0) {
			throw new Error("No compatible transports available from server");
		}

		let lastError: Error | null = null;

		for (const type of ordered) {
			const adapter = this.createAdapter(type, lastEventId);
			try {
				await adapter.connect();
				return adapter;
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));
				// Try next transport
			}
		}

		throw lastError ?? new Error("All transports failed to connect");
	}

	/**
	 * Probe the server capabilities endpoint.
	 * Caches the result for subsequent calls.
	 */
	async probeCapabilities(): Promise<string[]> {
		if (this.cachedCapabilities) {
			return this.cachedCapabilities;
		}

		const url = `${this.endpoint.replace(/\/$/, "")}/capabilities`;

		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Capabilities probe failed: ${response.status}`);
		}

		const body = (await response.json()) as { data: CapabilitiesResponse };
		const transports = body.data?.transports;

		if (!Array.isArray(transports)) {
			throw new Error("Invalid capabilities response");
		}

		this.cachedCapabilities = transports;
		return transports;
	}

	/** Clear cached capabilities (useful for retry logic) */
	clearCache(): void {
		this.cachedCapabilities = null;
	}
}
