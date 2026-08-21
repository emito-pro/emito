/**
 * Template builder utility.
 *
 * Converts lang → channel → strings maps into Record<string, EventTemplate>.
 * Each lang key maps to an EventTemplate with channel functions that return
 * the appropriate content shapes.
 */

import type { BrandTheme, EventTemplate, RenderContext } from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { formatSlackBlocks } from "./formatters/slack";
import { BaseEmailLayout } from "./layout/base-email-layout";
import { THEME_DEFAULTS } from "./theme-defaults";

// ---------------------------------------------------------------------------
// Channel string shapes
// ---------------------------------------------------------------------------

export interface EmailStrings {
	subject: string;
	heading: string;
	body: string;
	cta?: string;
	ctaUrl?: string;
}

export interface SmsStrings {
	body: string | ((payload: Record<string, unknown>) => string);
}

export interface PushStrings {
	title: string;
	body: string;
}

export interface InAppStrings {
	subject: string;
	body: string;
	actionUrl?: string;
}

export interface SlackStrings {
	header: string;
	body: string;
}

export interface TelegramStrings {
	html: string;
}

export interface ChannelStringsMap {
	email?: EmailStrings;
	sms?: SmsStrings;
	push?: PushStrings;
	inApp?: InAppStrings;
	slack?: SlackStrings;
	telegram?: TelegramStrings;
}

export type LangStringsMap = Record<string, ChannelStringsMap>;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export function buildTemplate(langs: LangStringsMap): Record<string, EventTemplate> {
	const result: Record<string, EventTemplate> = {};

	for (const [lang, channels] of Object.entries(langs)) {
		const template: EventTemplate = {};

		if (channels.email) {
			const strings = channels.email;
			template.email = async (
				_payload: Record<string, unknown>,
				brand: BrandTheme,
				ctx: RenderContext,
			) => {
				const html = await render(
					<BaseEmailLayout brand={brand} ctx={ctx} preview={strings.subject}>
						<Heading style={{ fontSize: "24px", margin: "0 0 16px 0" }}>{strings.heading}</Heading>
						<Text style={{ margin: "0 0 16px 0" }}>{strings.body}</Text>
						{strings.cta && (
							<Section style={{ textAlign: "center" as const }}>
								<Button
									href={strings.ctaUrl ?? brand.appUrl}
									style={{
										backgroundColor: brand.primaryColor ?? THEME_DEFAULTS.primaryColor,
										color: THEME_DEFAULTS.buttonTextColor,
										padding: THEME_DEFAULTS.buttonPadding,
										borderRadius: THEME_DEFAULTS.buttonRadius,
										fontWeight: "bold",
									}}
								>
									{strings.cta}
								</Button>
							</Section>
						)}
					</BaseEmailLayout>,
				);
				const text = `${strings.heading}\n\n${strings.body}${strings.cta ? `\n\n${strings.cta}: ${strings.ctaUrl ?? brand.appUrl}` : ""}`;
				return { subject: strings.subject, html, text };
			};
		}

		if (channels.sms) {
			const strings = channels.sms;
			template.sms = (
				payload: Record<string, unknown>,
				_brand: BrandTheme,
				_ctx: RenderContext,
			) => {
				const body = typeof strings.body === "function" ? strings.body(payload) : strings.body;
				return { body };
			};
		}

		if (channels.push) {
			const strings = channels.push;
			template.push = (
				_payload: Record<string, unknown>,
				_brand: BrandTheme,
				_ctx: RenderContext,
			) => {
				return { title: strings.title, body: strings.body };
			};
		}

		if (channels.inApp) {
			const strings = channels.inApp;
			template.inApp = (
				_payload: Record<string, unknown>,
				_brand: BrandTheme,
				_ctx: RenderContext,
			) => {
				return {
					subject: strings.subject,
					body: strings.body,
					actionUrl: strings.actionUrl,
				};
			};
		}

		if (channels.slack) {
			const strings = channels.slack;
			template.slack = (
				_payload: Record<string, unknown>,
				_brand: BrandTheme,
				_ctx: RenderContext,
			) => {
				return formatSlackBlocks({ header: strings.header, body: strings.body });
			};
		}

		if (channels.telegram) {
			const strings = channels.telegram;
			template.telegram = (
				_payload: Record<string, unknown>,
				_brand: BrandTheme,
				_ctx: RenderContext,
			) => {
				return { html: strings.html };
			};
		}

		result[lang] = template;
	}

	return result;
}
