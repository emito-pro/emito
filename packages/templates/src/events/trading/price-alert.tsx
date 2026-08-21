import type { BrandTheme, EventTemplate, PriceAlertPayload, RenderContext } from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

interface PriceAlertEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	symbol: string;
	threshold: string;
	currentPrice: string;
	direction: string;
	strings: typeof enStrings;
}

function PriceAlertEmail({
	brand,
	ctx,
	symbol,
	threshold,
	currentPrice,
	direction,
	strings,
}: PriceAlertEmailProps) {
	const alertColor = "#f59e0b";
	return (
		<BaseEmailLayout
			brand={brand}
			ctx={ctx}
			preview={`${symbol} ${strings[direction === "above" ? "crossedAbove" : "crossedBelow"]} ${threshold}`}
		>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0", color: alertColor }}>
				{strings.heading}
			</Heading>
			<Text style={{ fontSize: "18px", margin: "0 0 8px 0", fontWeight: "bold" }}>{symbol}</Text>
			<Text style={{ margin: "0 0 4px 0" }}>
				{direction === "above" ? strings.crossedAbove : strings.crossedBelow} {threshold}
			</Text>
			<Text style={{ margin: "0 0 16px 0", color: "#6b7280" }}>
				{strings.currentLabel}: {currentPrice}
			</Text>
			<Section style={{ textAlign: "center" as const }}>
				<Button
					href={`${brand.appUrl}/portfolio`}
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
		</BaseEmailLayout>
	);
}

const enStrings = {
	heading: "Price Alert",
	crossedAbove: "Crossed above",
	crossedBelow: "Crossed below",
	currentLabel: "Current price",
	cta: "View Market",
};

const langs = {
	en: {
		sms: (payload: PriceAlertPayload, _brand: BrandTheme, _ctx: RenderContext) => {
			const symbol = payload.symbol ?? "";
			const threshold = payload.threshold ?? "";
			const currentPrice = payload.currentPrice ?? "";
			return {
				body: `${enStrings.heading}: ${symbol} now at ${currentPrice} (threshold: ${threshold})`,
			};
		},
		push: (payload: PriceAlertPayload, _brand: BrandTheme, _ctx: RenderContext) => ({
			title: `${enStrings.heading}: ${payload.symbol ?? ""}`,
			body: `Now at ${payload.currentPrice ?? ""} (threshold: ${payload.threshold ?? ""})`,
		}),
		inApp: (payload: PriceAlertPayload, _brand: BrandTheme, _ctx: RenderContext) => ({
			subject: enStrings.heading,
			body: `${payload.symbol ?? ""} crossed your ${payload.threshold ?? ""} threshold — now trading at ${payload.currentPrice ?? ""}`,
			actionUrl: "/portfolio",
		}),
	},
} satisfies Record<string, EventTemplate<PriceAlertPayload>>;

export const priceAlertTemplates: Record<string, EventTemplate<PriceAlertPayload>> = langs;
