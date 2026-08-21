/**
 * Slack Block Kit builder utilities.
 */

import type { SlackContent } from "@emito/types";

export interface SlackBlockParams {
	header: string;
	body: string;
	fields?: Array<{ label: string; value: string }>;
	buttonText?: string;
	buttonUrl?: string;
	buttonStyle?: "primary" | "danger";
	contextText?: string;
}

export function formatSlackBlocks(params: SlackBlockParams): SlackContent {
	const blocks: unknown[] = [
		{
			type: "header",
			text: { type: "plain_text", text: params.header },
		},
		{
			type: "section",
			text: { type: "mrkdwn", text: params.body },
		},
	];

	if (params.fields && params.fields.length > 0) {
		blocks.push({
			type: "section",
			fields: params.fields.map((f) => ({
				type: "mrkdwn",
				text: `*${f.label}:*\n${f.value}`,
			})),
		});
	}

	if (params.buttonText && params.buttonUrl) {
		blocks.push(
			{ type: "divider" },
			{
				type: "actions",
				elements: [
					{
						type: "button",
						text: { type: "plain_text", text: params.buttonText },
						url: params.buttonUrl,
						...(params.buttonStyle ? { style: params.buttonStyle } : {}),
					},
				],
			},
		);
	}

	if (params.contextText) {
		blocks.push({
			type: "context",
			elements: [{ type: "mrkdwn", text: params.contextText }],
		});
	}

	return { blocks, text: `${params.header}: ${params.body}` };
}
