import type { Logger } from "@emito/types";

const noop = () => {};

/** Silent no-op logger. All methods are no-ops; child() returns itself. */
const noopLogger: Logger = {
	info: noop,
	warn: noop,
	error: noop,
	child() {
		return noopLogger;
	},
};

/** Creates a new silent no-op logger instance. */
export function createNoopLogger(): Logger {
	return noopLogger;
}

/** Returns the provided logger or a silent no-op logger. */
export function resolveLogger(logger: Logger | undefined): Logger {
	return logger ?? noopLogger;
}
