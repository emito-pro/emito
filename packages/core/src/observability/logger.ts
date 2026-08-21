import pino from "pino";

export type Logger = pino.Logger;

export interface CreateLoggerOptions {
	logger?: Logger;
}

/**
 * Returns the provided logger or creates a default pino instance at info level.
 * Library code never imports pino directly — the host injects via createEmito config.
 */
export function createLogger(options: CreateLoggerOptions): Logger {
	return options.logger ?? pino({ level: "info" });
}

/**
 * Alias for backward compatibility.
 */
export const resolveLogger = (logger?: Logger): Logger => createLogger({ logger });
