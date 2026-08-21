import type { BrandTheme, EventTemplate, OrderFillPayload, RenderContext } from "@emito/types";
import { Button, Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { formatSlackBlocks } from "../../formatters/slack";
import { BaseEmailLayout } from "../../layout/base-email-layout";
import { THEME_DEFAULTS } from "../../theme-defaults";

interface OrderFillEmailProps {
	brand: BrandTheme;
	ctx: RenderContext;
	symbol: string;
	shares: string;
	price: string;
	side: string;
	strings: typeof enStrings;
}

function OrderFillEmail({ brand, ctx, symbol, shares, price, side, strings }: OrderFillEmailProps) {
	const successColor = "#16a34a";
	return (
		<BaseEmailLayout
			brand={brand}
			ctx={ctx}
			preview={`${strings.heading}: ${shares} ${symbol} @ ${price}`}
		>
			<Heading style={{ fontSize: "24px", margin: "0 0 16px 0", color: successColor }}>
				{strings.heading}
			</Heading>
			<Text style={{ fontSize: "18px", margin: "0 0 8px 0", fontWeight: "bold" }}>
				{side === "sell" ? strings.sold : strings.bought} {shares} {symbol}
			</Text>
			<Text style={{ margin: "0 0 16px 0", color: "#6b7280" }}>
				{strings.priceLabel}: {price} {strings.perShare}
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
	heading: "Order Filled",
	bought: "Bought",
	sold: "Sold",
	priceLabel: "Fill price",
	perShare: "per share",
	cta: "View Portfolio",
	smsPrefix: "Order filled:",
};

const langs = {
	en: {
		email: async (payload: OrderFillPayload, brand: BrandTheme, ctx: RenderContext) => {
			const symbol = payload.symbol ?? "N/A";
			const shares = String(payload.shares ?? "");
			const price = payload.price ?? "";
			const side = payload.side ?? "buy";
			const html = await render(
				<OrderFillEmail
					brand={brand}
					ctx={ctx}
					symbol={symbol}
					shares={shares}
					price={price}
					side={side}
					strings={enStrings}
				/>,
			);
			const sideLabel = side === "sell" ? enStrings.sold : enStrings.bought;
			const text = `${enStrings.heading}\n\n${sideLabel} ${shares} ${symbol} @ ${price}\n\n${enStrings.cta}: ${brand.appUrl}/portfolio`;
			return { subject: `${enStrings.heading}: ${shares} ${symbol} @ ${price}`, html, text };
		},
		sms: (payload: OrderFillPayload, _brand: BrandTheme, _ctx: RenderContext) => {
			const symbol = payload.symbol ?? "";
			const shares = String(payload.shares ?? "");
			const price = payload.price ?? "";
			return { body: `${enStrings.smsPrefix} ${shares} ${symbol} @ ${price}` };
		},
		push: (payload: OrderFillPayload, _brand: BrandTheme, _ctx: RenderContext) => ({
			title: enStrings.heading,
			body: `${payload.shares ?? ""} ${payload.symbol ?? ""} @ ${payload.price ?? ""}`,
		}),
		inApp: (payload: OrderFillPayload, _brand: BrandTheme, _ctx: RenderContext) => ({
			subject: enStrings.heading,
			body: `Your order for ${payload.shares ?? ""} shares of ${payload.symbol ?? ""} has been filled at ${payload.price ?? ""}`,
			actionUrl: "/portfolio",
		}),
		slack: (payload: OrderFillPayload, brand: BrandTheme, _ctx: RenderContext) => {
			const side = payload.side === "sell" ? enStrings.sold : enStrings.bought;
			return formatSlackBlocks({
				header: `✅ ${enStrings.heading}`,
				body: `${side} ${payload.shares ?? ""} *${payload.symbol ?? ""}* @ ${payload.price ?? ""}`,
				buttonText: enStrings.cta,
				buttonUrl: `${brand.appUrl}/portfolio`,
			});
		},
		telegram: (payload: OrderFillPayload, _brand: BrandTheme, _ctx: RenderContext) => {
			const side = payload.side === "sell" ? `📉 ${enStrings.sold}` : `📈 ${enStrings.bought}`;
			return {
				html: `✅ <b>${enStrings.heading}</b>\n\n${side} ${payload.shares ?? ""} <b>${payload.symbol ?? ""}</b> @ ${payload.price ?? ""}`,
			};
		},
	},
} satisfies Record<string, EventTemplate<OrderFillPayload>>;

export const orderFillTemplates: Record<string, EventTemplate<OrderFillPayload>> = langs;
