import type { Channel } from "@emito/types";

export interface RenderedContent {
	subject?: string;
	body: string;
	html?: string;
	text?: string;
	data?: Record<string, unknown>;
}

export interface ResolveParams {
	event: string;
	channel: Channel;
	lang: string;
	/** Full BCP 47 locale for Intl formatters (e.g. 'pl-PL'). */
	locale?: string;
	/** IANA timezone for date rendering (e.g. 'Europe/Warsaw'). */
	timezone?: string;
	payload: Record<string, unknown>;
}

export interface TemplateResolver {
	resolve(params: ResolveParams): Promise<RenderedContent>;
}

/**
 * Passthrough template resolver that wraps the payload as-is.
 * Real template rendering is handled by the dedicated template engine.
 */
export function createPassthroughResolver(): TemplateResolver {
	return {
		async resolve(params: ResolveParams): Promise<RenderedContent> {
			const { payload } = params;
			return {
				subject: typeof payload.subject === "string" ? payload.subject : undefined,
				body: typeof payload.body === "string" ? payload.body : JSON.stringify(payload),
				html: typeof payload.html === "string" ? payload.html : undefined,
				text: typeof payload.text === "string" ? payload.text : undefined,
				data: payload,
			};
		},
	};
}
