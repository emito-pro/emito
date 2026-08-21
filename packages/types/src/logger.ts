/**
 * Minimal pino-compatible logger interface.
 * Any package can depend on this without pulling in pino as a runtime dependency.
 * Fields-first format: structured object first, optional static message second.
 */
export interface Logger {
	info(fields: Record<string, unknown>, msg?: string): void;
	warn(fields: Record<string, unknown>, msg?: string): void;
	error(fields: Record<string, unknown>, msg?: string): void;
	child(bindings: Record<string, unknown>): Logger;
}
