/**
 * Generic fallback template.
 *
 * Produces readable content from event name + payload key-values
 * for all channels: email, SMS, push, inApp, slack, telegram.
 */

import type { EventTemplate } from "@emito/types";

function formatKeyValues(payload: Record<string, unknown>): string {
	const entries = Object.entries(payload);
	if (entries.length === 0) return "(no data)";
	return entries.map(([k, v]) => `${k}: ${String(v)}`).join(", ");
}

function formatKeyValuesHtml(payload: Record<string, unknown>): string {
	const entries = Object.entries(payload);
	if (entries.length === 0) return "<b>No data</b>";
	return entries.map(([k, v]) => `<b>${k}</b>: ${String(v)}`).join("\n");
}

function firstValue(payload: Record<string, unknown>): string {
	const values = Object.values(payload);
	if (values.length === 0) return "";
	return String(values[0]);
}

export function createFallbackTemplate(eventName: string): EventTemplate {
	return {
		email: async (payload, _brand, _ctx) => {
			const text = `${eventName}\n\n${formatKeyValues(payload)}`;
			const html = `<b>${eventName}</b>\n\n${formatKeyValuesHtml(payload)}`;
			return { subject: eventName, html, text };
		},
		sms: (payload, _brand, _ctx) => {
			const value = firstValue(payload);
			const raw = value ? `${eventName}: ${value}` : eventName;
			const body = raw.length > 160 ? `${raw.slice(0, 157)}...` : raw;
			return { body };
		},
		push: (payload, _brand, _ctx) => {
			const value = firstValue(payload);
			return { title: eventName, body: value || eventName };
		},
		inApp: (payload, _brand, _ctx) => {
			return { subject: eventName, body: formatKeyValues(payload) };
		},
		slack: (payload, _brand, _ctx) => {
			const blocks: unknown[] = [
				{
					type: "header",
					text: { type: "plain_text", text: eventName },
				},
				{
					type: "section",
					text: { type: "mrkdwn", text: formatKeyValues(payload) },
				},
			];
			return { blocks, text: eventName };
		},
		telegram: (payload, _brand, _ctx) => {
			const entries = Object.entries(payload);
			const lines = entries.map(([k, v]) => `<b>${k}</b>: ${String(v)}`);
			const html = `<b>${eventName}</b>\n\n${lines.join("\n") || "(no data)"}`;
			return { html };
		},
	};
}
