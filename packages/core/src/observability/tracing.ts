import { SpanStatusCode, context, trace } from "@opentelemetry/api";
import type { Span, Tracer } from "@opentelemetry/api";

const TRACER_NAME = "emito";

export interface CreateTracerOptions {
	enabled?: boolean;
}

/**
 * Returns a tracer. When no OTel SDK is registered, this returns a noop tracer
 * (zero-cost — all span operations become no-ops).
 */
export function createTracer(_options: CreateTracerOptions): Tracer {
	return trace.getTracer(TRACER_NAME);
}

/**
 * Returns the global tracer.
 */
export function getTracer(): Tracer {
	return trace.getTracer(TRACER_NAME);
}

/**
 * Starts a span as a child of the current active span (or as root if none).
 */
export function startSpan(
	name: string,
	attributes?: Record<string, string | number | boolean>,
): Span {
	const tracer = getTracer();
	return tracer.startSpan(name, { attributes });
}

/**
 * Runs a function within a new span context. The span is automatically ended
 * when the function completes (or errors).
 */
export async function withSpan<T>(
	name: string,
	attributes: Record<string, string | number | boolean>,
	fn: (span: Span) => Promise<T>,
): Promise<T> {
	const tracer = getTracer();
	const span = tracer.startSpan(name, { attributes });
	const ctx = trace.setSpan(context.active(), span);

	try {
		const result = await context.with(ctx, () => fn(span));
		span.end();
		return result;
	} catch (error) {
		span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
		span.end();
		throw error;
	}
}

/**
 * Records an error event on a span without setting the span status to ERROR.
 * Used for transient failures that will be retried.
 */
export function recordSpanEvent(
	span: Span,
	name: string,
	attributes?: Record<string, string | number | boolean>,
): void {
	span.addEvent(name, attributes);
}

/**
 * Sets span status to ERROR for permanent failures.
 */
export function setSpanError(span: Span, errorCode: string, message: string): void {
	span.setStatus({ code: SpanStatusCode.ERROR, message });
	span.setAttribute("error.code", errorCode);
}
