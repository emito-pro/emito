/**
 * Tests for Slack Block Kit and Telegram HTML formatter utilities.
 *
 * Covers all optional parameter branches:
 *   - formatSlackBlocks: fields, button, contextText
 *   - formatTelegramHtml: fields, link
 *
 * Rules applied (testing standards):
 * - Test boundary conditions (rule 4): no optional fields, all optional fields
 * - Test empty collections (rule 4): empty fields array
 * - Test undefined/absent optional parameters (rule 5)
 * - Never mock the module under test (rule 10)
 * - Follow describe("functionName") > it("should X when Y") naming (rule 15)
 * - Assert on shape of return values (rule 26)
 * - Use specific matchers (rule 25)
 */

import { describe, expect, it } from "vitest";
import { formatSlackBlocks } from "../formatters/slack";
import { formatTelegramHtml } from "../formatters/telegram";

// Typed block interface for test assertions against Slack Block Kit JSON
interface SlackBlock {
	type: string;
	text?: { type: string; text: string };
	fields?: Array<{ type: string; text: string }>;
	elements?: Array<{
		type: string;
		text?: { type: string; text: string };
		url?: string;
		style?: string;
	}>;
}

// ---------------------------------------------------------------------------
// formatSlackBlocks
// ---------------------------------------------------------------------------

describe("formatSlackBlocks", () => {
	describe("minimal output (header + body only)", () => {
		it("should return blocks array and text string", () => {
			const result = formatSlackBlocks({ header: "My Header", body: "My Body" });
			expect(result.blocks).toBeInstanceOf(Array);
			expect(typeof result.text).toBe("string");
		});

		it("should include header block with correct text", () => {
			const result = formatSlackBlocks({ header: "Security Alert", body: "Something happened" });
			const headerBlock = (result.blocks as SlackBlock[]).find((b) => b.type === "header")!;
			expect(headerBlock).toBeDefined();
			expect(headerBlock.text!.text).toBe("Security Alert");
		});

		it("should include section block with body text", () => {
			const result = formatSlackBlocks({ header: "Alert", body: "Details here" });
			const sectionBlock = (result.blocks as SlackBlock[]).find((b) => b.type === "section")!;
			expect(sectionBlock).toBeDefined();
			expect(sectionBlock.text!.text).toBe("Details here");
		});

		it("should set text to 'header: body' format", () => {
			const result = formatSlackBlocks({ header: "Alert", body: "Details" });
			expect(result.text).toBe("Alert: Details");
		});

		it("should produce exactly 2 blocks when no optional params given", () => {
			const result = formatSlackBlocks({ header: "H", body: "B" });
			expect((result.blocks as SlackBlock[]).length).toBe(2);
		});
	});

	describe("with fields", () => {
		it("should add a section block with fields when fields are provided", () => {
			const result = formatSlackBlocks({
				header: "Alert",
				body: "Details",
				fields: [
					{ label: "Device", value: "Chrome on Windows" },
					{ label: "Location", value: "Warsaw, Poland" },
				],
			});
			const sectionBlocks = (result.blocks as SlackBlock[]).filter((b) => b.type === "section");
			// One for body, one for fields
			expect(sectionBlocks.length).toBeGreaterThanOrEqual(2);
		});

		it("should format fields as mrkdwn label:value pairs", () => {
			const result = formatSlackBlocks({
				header: "Alert",
				body: "Details",
				fields: [{ label: "IP", value: "203.0.113.42" }],
			});
			const fieldsSection = (result.blocks as SlackBlock[]).find((b) => b.fields)!;
			expect(fieldsSection).toBeDefined();
			const fieldText = fieldsSection.fields![0]!.text;
			expect(fieldText).toContain("*IP:*");
			expect(fieldText).toContain("203.0.113.42");
		});

		it("should not add a fields section block when fields is empty array", () => {
			const result = formatSlackBlocks({ header: "H", body: "B", fields: [] });
			// Empty fields array should not produce a fields section
			const fieldsSection = (result.blocks as SlackBlock[]).find((b) => b.fields);
			expect(fieldsSection).toBeUndefined();
			expect((result.blocks as SlackBlock[]).length).toBe(2);
		});
	});

	describe("with button", () => {
		it("should add divider and actions block when buttonText and buttonUrl are provided", () => {
			const result = formatSlackBlocks({
				header: "Alert",
				body: "Details",
				buttonText: "Secure Account",
				buttonUrl: "https://myapp.example.com/security",
			});
			const divider = (result.blocks as SlackBlock[]).find((b) => b.type === "divider");
			const actions = (result.blocks as SlackBlock[]).find((b) => b.type === "actions");
			expect(divider).toBeDefined();
			expect(actions).toBeDefined();
		});

		it("should include button with correct text and url", () => {
			const result = formatSlackBlocks({
				header: "Alert",
				body: "Details",
				buttonText: "Secure Account",
				buttonUrl: "https://myapp.example.com/security",
			});
			const actions = (result.blocks as SlackBlock[]).find((b) => b.type === "actions")!;
			const button = actions.elements![0]!;
			expect(button.type).toBe("button");
			expect(button.text!.text).toBe("Secure Account");
			expect(button.url).toBe("https://myapp.example.com/security");
		});

		it("should apply buttonStyle when provided", () => {
			const result = formatSlackBlocks({
				header: "Alert",
				body: "Details",
				buttonText: "Secure",
				buttonUrl: "https://myapp.example.com/security",
				buttonStyle: "danger",
			});
			const actions = (result.blocks as SlackBlock[]).find((b) => b.type === "actions")!;
			const button = actions.elements![0]!;
			expect(button.style).toBe("danger");
		});

		it("should not include style property when buttonStyle is not provided", () => {
			const result = formatSlackBlocks({
				header: "Alert",
				body: "Details",
				buttonText: "Click",
				buttonUrl: "https://myapp.example.com",
			});
			const actions = (result.blocks as SlackBlock[]).find((b) => b.type === "actions")!;
			const button = actions.elements![0]!;
			expect(button.style).toBeUndefined();
		});

		it("should not add button blocks when only buttonText is provided (no url)", () => {
			const result = formatSlackBlocks({
				header: "H",
				body: "B",
				buttonText: "Click",
				// buttonUrl omitted
			});
			const actions = (result.blocks as SlackBlock[]).find((b) => b.type === "actions");
			expect(actions).toBeUndefined();
		});

		it("should not add button blocks when only buttonUrl is provided (no text)", () => {
			const result = formatSlackBlocks({
				header: "H",
				body: "B",
				buttonUrl: "https://myapp.example.com",
				// buttonText omitted
			});
			const actions = (result.blocks as SlackBlock[]).find((b) => b.type === "actions");
			expect(actions).toBeUndefined();
		});
	});

	describe("with contextText", () => {
		it("should add a context block when contextText is provided", () => {
			const result = formatSlackBlocks({
				header: "Alert",
				body: "Details",
				contextText: "Sent via MyApp notifications",
			});
			const contextBlock = (result.blocks as SlackBlock[]).find((b) => b.type === "context");
			expect(contextBlock).toBeDefined();
		});

		it("should include contextText in the context block", () => {
			const result = formatSlackBlocks({
				header: "Alert",
				body: "Details",
				contextText: "Sent via MyApp notifications",
			});
			const contextBlock = (result.blocks as SlackBlock[]).find((b) => b.type === "context")!;
			expect(contextBlock.elements![0]!.text).toBe("Sent via MyApp notifications");
		});

		it("should not add context block when contextText is absent", () => {
			const result = formatSlackBlocks({ header: "H", body: "B" });
			const contextBlock = (result.blocks as SlackBlock[]).find((b) => b.type === "context");
			expect(contextBlock).toBeUndefined();
		});
	});

	describe("full output (all options)", () => {
		it("should produce all block types when all options are provided", () => {
			const result = formatSlackBlocks({
				header: "Security Alert",
				body: "New login detected",
				fields: [
					{ label: "Device", value: "Chrome" },
					{ label: "Location", value: "Warsaw" },
				],
				buttonText: "Secure Account",
				buttonUrl: "https://myapp.example.com/security",
				buttonStyle: "danger",
				contextText: "Sent via MyApp",
			});
			const types = (result.blocks as SlackBlock[]).map((b) => b.type);
			expect(types).toContain("header");
			expect(types).toContain("section");
			expect(types).toContain("divider");
			expect(types).toContain("actions");
			expect(types).toContain("context");
		});
	});
});

// ---------------------------------------------------------------------------
// formatTelegramHtml
// ---------------------------------------------------------------------------

describe("formatTelegramHtml", () => {
	describe("minimal output (title + body only)", () => {
		it("should return an html string", () => {
			const result = formatTelegramHtml({ title: "Security Alert", body: "Something happened" });
			expect(typeof result.html).toBe("string");
			expect(result.html.length).toBeGreaterThan(0);
		});

		it("should wrap title in bold tags", () => {
			const result = formatTelegramHtml({ title: "Security Alert", body: "Details" });
			expect(result.html).toContain("<b>Security Alert</b>");
		});

		it("should include the body text", () => {
			const result = formatTelegramHtml({ title: "Title", body: "My body text here" });
			expect(result.html).toContain("My body text here");
		});

		it("should only use allowed Telegram HTML tags (b, i, a, code, pre)", () => {
			const result = formatTelegramHtml({ title: "Title", body: "Body" });
			expect(result.html).not.toMatch(/<div|<p>|<span|<table|<ul|<li/);
		});
	});

	describe("with fields", () => {
		it("should include field label-value pairs in the output", () => {
			const result = formatTelegramHtml({
				title: "Alert",
				body: "Details",
				fields: [
					{ label: "Device", value: "Chrome" },
					{ label: "IP", value: "203.0.113.42" },
				],
			});
			expect(result.html).toContain("Device");
			expect(result.html).toContain("Chrome");
			expect(result.html).toContain("IP");
			expect(result.html).toContain("203.0.113.42");
		});

		it("should wrap field labels in bold tags", () => {
			const result = formatTelegramHtml({
				title: "Alert",
				body: "Details",
				fields: [{ label: "Device", value: "Chrome" }],
			});
			expect(result.html).toContain("<b>Device:</b>");
		});

		it("should not add field section when fields is empty array", () => {
			const withEmpty = formatTelegramHtml({ title: "T", body: "B", fields: [] });
			const withoutFields = formatTelegramHtml({ title: "T", body: "B" });
			// Empty fields should produce same output as no fields
			expect(withEmpty.html).toBe(withoutFields.html);
		});
	});

	describe("with link", () => {
		it("should add an anchor tag when both linkText and linkUrl are provided", () => {
			const result = formatTelegramHtml({
				title: "Alert",
				body: "Details",
				linkText: "Secure Account",
				linkUrl: "https://myapp.example.com/security",
			});
			expect(result.html).toContain(
				'<a href="https://myapp.example.com/security">Secure Account</a>',
			);
		});

		it("should not add an anchor when only linkText is provided (no url)", () => {
			const result = formatTelegramHtml({
				title: "T",
				body: "B",
				linkText: "Click",
				// linkUrl omitted
			});
			expect(result.html).not.toContain("<a href");
		});

		it("should not add an anchor when only linkUrl is provided (no text)", () => {
			const result = formatTelegramHtml({
				title: "T",
				body: "B",
				linkUrl: "https://myapp.example.com",
				// linkText omitted
			});
			expect(result.html).not.toContain("<a href");
		});
	});

	describe("full output (all options)", () => {
		it("should include all elements when all options are provided", () => {
			const result = formatTelegramHtml({
				title: "Security Alert",
				body: "New login from Chrome on Windows",
				fields: [
					{ label: "Device", value: "Chrome" },
					{ label: "Location", value: "Warsaw" },
				],
				linkText: "Secure Account",
				linkUrl: "https://myapp.example.com/security",
			});
			expect(result.html).toContain("<b>Security Alert</b>");
			expect(result.html).toContain("New login from Chrome on Windows");
			expect(result.html).toContain("<b>Device:</b>");
			expect(result.html).toContain(
				'<a href="https://myapp.example.com/security">Secure Account</a>',
			);
		});
	});
});
