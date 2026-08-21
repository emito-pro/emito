/**
 * Shared React Email layout component with BrandTheme + extra slot.
 *
 * All email templates use this as their outer wrapper. It provides:
 * - Brand header (logo or name)
 * - Primary color accent
 * - Children content area
 * - Optional `extra` slot for per-lang additions
 * - Footer with optional unsubscribe, privacy, and support links
 */

import type { BrandTheme, RenderContext } from "@emito/types";
import {
	Body,
	Container,
	Head,
	Hr,
	Html,
	Img,
	Link,
	Preview,
	Section,
	Text,
} from "@react-email/components";
import type { ReactNode } from "react";
import { isRtl } from "../formatters/rtl";
import { THEME_DEFAULTS } from "../theme-defaults";

export interface BaseEmailLayoutStrings {
	unsubscribe?: string;
	privacy?: string;
	support?: string;
}

export interface BaseEmailLayoutProps {
	brand: BrandTheme;
	ctx: RenderContext;
	preview?: string;
	extra?: ReactNode;
	strings?: BaseEmailLayoutStrings;
	direction?: "ltr" | "rtl";
	children: ReactNode;
}

const DEFAULT_STRINGS: Required<BaseEmailLayoutStrings> = {
	unsubscribe: "Unsubscribe",
	privacy: "Privacy",
	support: "Support",
};

export function BaseEmailLayout({
	brand,
	ctx,
	preview,
	extra,
	strings,
	direction,
	children,
}: BaseEmailLayoutProps) {
	const primaryColor = brand.primaryColor ?? THEME_DEFAULTS.primaryColor;
	const backgroundColor = brand.backgroundColor ?? THEME_DEFAULTS.backgroundColor;
	const textColor = brand.textColor ?? THEME_DEFAULTS.textColor;
	const fontFamily = brand.fontFamily ?? THEME_DEFAULTS.fontFamily;
	const s = { ...DEFAULT_STRINGS, ...strings };
	const dir = direction ?? (isRtl(ctx.locale) ? "rtl" : "ltr");

	return (
		<Html lang={ctx.locale.split("-")[0]} dir={dir}>
			<Head />
			{preview && <Preview>{preview}</Preview>}
			<Body style={{ backgroundColor, fontFamily, margin: "0", padding: "0" }}>
				<Container style={{ maxWidth: "600px", margin: "0 auto", padding: "20px" }}>
					{/* Header */}
					<Section style={{ textAlign: "center" as const, paddingBottom: "20px" }}>
						{brand.logoUrl ? (
							<Link href={brand.appUrl}>
								<Img
									src={brand.logoUrl}
									alt={brand.name}
									height="40"
									style={{ margin: "0 auto" }}
								/>
							</Link>
						) : (
							<Link
								href={brand.appUrl}
								style={{
									color: primaryColor,
									fontSize: "24px",
									fontWeight: "bold",
									textDecoration: "none",
								}}
							>
								{brand.name}
							</Link>
						)}
					</Section>

					<Hr style={{ borderColor: primaryColor, borderWidth: "2px", margin: "0 0 20px 0" }} />

					{/* Main content */}
					<Section style={{ color: textColor }}>{children}</Section>

					{/* Extra slot */}
					{extra && <Section style={{ color: textColor, marginTop: "20px" }}>{extra}</Section>}

					<Hr style={{ borderColor: THEME_DEFAULTS.separatorColor, margin: "20px 0" }} />

					{/* Footer */}
					<Section
						style={{
							textAlign: "center" as const,
							color: THEME_DEFAULTS.mutedColor,
							fontSize: "12px",
						}}
					>
						{brand.footer && <Text style={{ margin: "0 0 8px 0" }}>{brand.footer}</Text>}
						<Text style={{ margin: "0" }}>
							{brand.unsubscribeUrl && (
								<>
									<Link href={brand.unsubscribeUrl} style={{ color: THEME_DEFAULTS.mutedColor }}>
										{s.unsubscribe}
									</Link>
									{(brand.privacyUrl || brand.supportEmail) && " | "}
								</>
							)}
							{brand.privacyUrl && (
								<>
									<Link href={brand.privacyUrl} style={{ color: THEME_DEFAULTS.mutedColor }}>
										{s.privacy}
									</Link>
									{brand.supportEmail && " | "}
								</>
							)}
							{brand.supportEmail && (
								<Link
									href={`mailto:${brand.supportEmail}`}
									style={{ color: THEME_DEFAULTS.mutedColor }}
								>
									{s.support}
								</Link>
							)}
						</Text>
						<Text style={{ margin: "8px 0 0 0" }}>
							<Link href={brand.appUrl} style={{ color: THEME_DEFAULTS.mutedColor }}>
								{brand.name}
							</Link>
						</Text>
					</Section>
				</Container>
			</Body>
		</Html>
	);
}
