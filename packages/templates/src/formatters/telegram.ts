/**
 * Telegram HTML formatter utilities.
 *
 * Telegram supports a limited HTML subset: b, i, a, code, pre.
 * These utilities ensure only valid tags are produced.
 */

import type { TelegramContent } from "@emito/types";

export interface TelegramMessageParams {
	title: string;
	body: string;
	linkText?: string;
	linkUrl?: string;
	fields?: Array<{ label: string; value: string }>;
}

export function formatTelegramHtml(params: TelegramMessageParams): TelegramContent {
	const lines: string[] = [];

	lines.push(`<b>${params.title}</b>`);
	lines.push("");
	lines.push(params.body);

	if (params.fields && params.fields.length > 0) {
		lines.push("");
		for (const field of params.fields) {
			lines.push(`<b>${field.label}:</b> ${field.value}`);
		}
	}

	if (params.linkText && params.linkUrl) {
		lines.push("");
		lines.push(`<a href="${params.linkUrl}">${params.linkText}</a>`);
	}

	return { html: lines.join("\n") };
}
